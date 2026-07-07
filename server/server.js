const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_FILE = path.join(__dirname, "data.json");
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let storageReady = false;

if (DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });
}

function now() {
  return new Date().toISOString();
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function defaultData() {
  const createdAt = now();
  return {
    platform: {
      superAdminKeyHash: hashSecret("super-root-1234"),
      updatedAt: createdAt,
    },
    customerAdmins: {
      "customer-demo": {
        id: "customer-demo",
        name: "Demo Customer Admin",
        role: "customer_admin",
        adminKeyHash: hashSecret("admin-demo-1234"),
        appKeys: ["demo"],
        createdAt,
        updatedAt: createdAt,
      },
    },
    apps: {
      demo: {
        appKey: "demo",
        name: "Demo App",
        ownerAdminId: "customer-demo",
        url: "https://example.com",
        createdBy: "super_admin",
        createdAt,
        updatedAt: createdAt,
      },
    },
    endUsers: {},
  };
}

function migrateData(data) {
  const base = defaultData();
  data.platform = data.platform || base.platform;
  data.customerAdmins = data.customerAdmins || base.customerAdmins;
  data.apps = data.apps || {};
  data.endUsers = data.endUsers || {};

  if (!data.customerAdmins["customer-demo"]) {
    data.customerAdmins["customer-demo"] = base.customerAdmins["customer-demo"];
  }

  for (const [appKey, app] of Object.entries(data.apps)) {
    app.appKey = app.appKey || appKey;
    app.ownerAdminId = app.ownerAdminId || "customer-demo";
    app.createdBy = app.createdBy || "super_admin";
    app.createdAt = app.createdAt || app.updatedAt || now();
    app.updatedAt = app.updatedAt || now();

    const owner = data.customerAdmins[app.ownerAdminId];
    if (owner && !owner.appKeys.includes(appKey)) {
      owner.appKeys.push(appKey);
    }
  }

  if (!data.apps.demo) data.apps.demo = base.apps.demo;
  return data;
}

async function initStorage() {
  if (storageReady) return;
  storageReady = true;
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS customer_admins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      admin_key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS apps (
      app_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_admin_id TEXT NOT NULL REFERENCES customer_admins(id) ON DELETE RESTRICT,
      url TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'super_admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS end_users (
      device_id TEXT NOT NULL,
      app_key TEXT NOT NULL REFERENCES apps(app_key) ON DELETE CASCADE,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (device_id, app_key)
    );
  `);

  const count = await pool.query("SELECT COUNT(*)::int AS count FROM platform_settings WHERE key = 'super_admin_key_hash'");
  if (count.rows[0].count === 0) {
    await writeData(defaultData());
  }
}

async function readData() {
  await initStorage();
  if (pool) return readDatabaseData();

  if (!fs.existsSync(DATA_FILE)) {
    const data = defaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return data;
  }

  const data = migrateData(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
}

async function readDatabaseData() {
  const [settings, admins, apps, users] = await Promise.all([
    pool.query("SELECT key, value, updated_at FROM platform_settings"),
    pool.query("SELECT id, name, admin_key_hash, created_at, updated_at FROM customer_admins ORDER BY id"),
    pool.query("SELECT app_key, name, owner_admin_id, url, created_by, created_at, updated_at FROM apps ORDER BY app_key"),
    pool.query("SELECT device_id, app_key, first_seen_at, last_seen_at FROM end_users"),
  ]);

  const data = { platform: {}, customerAdmins: {}, apps: {}, endUsers: {} };
  const superSetting = settings.rows.find((row) => row.key === "super_admin_key_hash");
  data.platform = {
    superAdminKeyHash: superSetting ? superSetting.value : hashSecret("super-root-1234"),
    updatedAt: superSetting ? superSetting.updated_at.toISOString() : now(),
  };

  for (const admin of admins.rows) {
    data.customerAdmins[admin.id] = {
      id: admin.id,
      name: admin.name,
      role: "customer_admin",
      adminKeyHash: admin.admin_key_hash,
      appKeys: [],
      createdAt: admin.created_at.toISOString(),
      updatedAt: admin.updated_at.toISOString(),
    };
  }

  for (const app of apps.rows) {
    data.apps[app.app_key] = {
      appKey: app.app_key,
      name: app.name,
      ownerAdminId: app.owner_admin_id,
      url: app.url,
      createdBy: app.created_by,
      createdAt: app.created_at.toISOString(),
      updatedAt: app.updated_at.toISOString(),
    };
    if (data.customerAdmins[app.owner_admin_id]) {
      data.customerAdmins[app.owner_admin_id].appKeys.push(app.app_key);
    }
  }

  for (const user of users.rows) {
    const key = `${user.app_key}:${user.device_id}`;
    data.endUsers[key] = {
      deviceId: user.device_id,
      appKey: user.app_key,
      firstSeenAt: user.first_seen_at.toISOString(),
      lastSeenAt: user.last_seen_at.toISOString(),
    };
  }

  return migrateData(data);
}

async function writeData(data) {
  if (pool) {
    await writeDatabaseData(migrateData(data));
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function writeDatabaseData(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ('super_admin_key_hash', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [data.platform.superAdminKeyHash]
    );

    for (const admin of Object.values(data.customerAdmins)) {
      await client.query(
        `INSERT INTO customer_admins (id, name, admin_key_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, admin_key_hash = EXCLUDED.admin_key_hash, updated_at = EXCLUDED.updated_at`,
        [admin.id, admin.name, admin.adminKeyHash, admin.createdAt, admin.updatedAt]
      );
    }

    for (const app of Object.values(data.apps)) {
      await client.query(
        `INSERT INTO apps (app_key, name, owner_admin_id, url, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (app_key) DO UPDATE
         SET name = EXCLUDED.name, owner_admin_id = EXCLUDED.owner_admin_id, url = EXCLUDED.url, updated_at = EXCLUDED.updated_at`,
        [app.appKey, app.name, app.ownerAdminId, app.url, app.createdBy, app.createdAt, app.updatedAt]
      );
    }

    for (const user of Object.values(data.endUsers || {})) {
      await client.query(
        `INSERT INTO end_users (device_id, app_key, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_id, app_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
        [user.deviceId, user.appKey, user.firstSeenAt, user.lastSeenAt]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isValidId(value) {
  return /^[a-zA-Z0-9_-]{2,64}$/.test(value || "");
}

function normalizeUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  return url.toString();
}

function hasSuperAdminAccess(data, superAdminKey) {
  return Boolean(superAdminKey && data.platform.superAdminKeyHash === hashSecret(superAdminKey));
}

function hasCustomerAdminAccess(data, app, adminId, adminKey) {
  if (!adminKey || !app) return false;

  const ownerId = app.ownerAdminId;
  if (adminId && adminId !== ownerId) return false;

  const owner = data.customerAdmins[ownerId];
  if (owner && owner.adminKeyHash === hashSecret(adminKey) && owner.appKeys.includes(app.appKey)) {
    return true;
  }

  // Compatibility for data created by the first simple prototype.
  return Array.isArray(app.adminKeyHashes) && app.adminKeyHashes.includes(hashSecret(adminKey));
}

function publicApp(appKey, app) {
  return {
    appKey,
    name: app.name,
    url: app.url,
    updatedAt: app.updatedAt,
  };
}

function buildOverview(data) {
  const userCountsByApp = {};
  for (const user of Object.values(data.endUsers || {})) {
    userCountsByApp[user.appKey] = (userCountsByApp[user.appKey] || 0) + 1;
  }

  return {
    generatedAt: now(),
    totals: {
      customerAdmins: Object.keys(data.customerAdmins).length,
      apps: Object.keys(data.apps).length,
      endUsers: Object.keys(data.endUsers || {}).length,
    },
    customerAdmins: Object.values(data.customerAdmins).map((admin) => {
      const apps = admin.appKeys.map((appKey) => data.apps[appKey]).filter(Boolean);
      return {
        adminId: admin.id,
        name: admin.name,
        appCount: apps.length,
        endUserCount: apps.reduce((sum, app) => sum + (userCountsByApp[app.appKey] || 0), 0),
        apps: apps.map((app) => ({
          appKey: app.appKey,
          name: app.name,
          url: app.url,
          endUserCount: userCountsByApp[app.appKey] || 0,
          updatedAt: app.updatedAt,
        })),
      };
    }),
  };
}

function adminPage() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Web1 Platform Admin</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f5f7fb; color: #172033; }
    main { max-width: 980px; margin: 40px auto; padding: 0 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { color: #5b6475; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    section { background: white; border: 1px solid #dfe5ef; border-radius: 8px; padding: 20px; box-shadow: 0 10px 30px rgba(23, 32, 51, .08); }
    h2 { margin: 0 0 12px; font-size: 18px; }
    label { display: block; margin: 12px 0 5px; font-weight: 650; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #cbd4e1; border-radius: 6px; padding: 11px; font: inherit; }
    button { margin-top: 16px; border: 0; border-radius: 6px; padding: 11px 14px; background: #1769e0; color: white; font-weight: 700; cursor: pointer; }
    pre { white-space: pre-wrap; background: #101828; color: #d1fadf; border-radius: 6px; padding: 12px; min-height: 44px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <h1>Web1 3-Level Platform</h1>
    <p>Role tree: Super Admin -> Customer Admin -> End User. End users only read app URL settings through the app key.</p>
    <div class="grid">
      <section>
        <h2>Super Admin: create customer admin</h2>
        <label>Super Admin Key</label><input id="superKey1" value="super-root-1234">
        <label>Customer Admin ID</label><input id="newAdminId" value="customer-demo">
        <label>Customer Admin Name</label><input id="newAdminName" value="Demo Customer Admin">
        <label>Customer Admin Key</label><input id="newAdminKey" value="admin-demo-1234">
        <button id="createAdmin">Create / Update Customer Admin</button>
      </section>
      <section>
        <h2>Super Admin: create app</h2>
        <label>Super Admin Key</label><input id="superKey2" value="super-root-1234">
        <label>App Key</label><input id="newAppKey" value="demo">
        <label>App Name</label><input id="newAppName" value="Demo App">
        <label>Owner Customer Admin ID</label><input id="ownerAdminId" value="customer-demo">
        <label>Initial URL</label><input id="initialUrl" value="https://example.com">
        <button id="createApp">Create / Update App</button>
      </section>
      <section>
        <h2>Customer Admin: update app URL</h2>
        <label>Customer Admin ID</label><input id="adminId" value="customer-demo">
        <label>Customer Admin Key</label><input id="adminKey" value="admin-demo-1234">
        <label>App Key</label><input id="appKey" value="demo">
        <label>URL</label><input id="url" value="https://example.com">
        <button id="saveUrl">Save URL</button>
      </section>
      <section>
        <h2>Result</h2>
        <pre id="result">Ready</pre>
      </section>
    </div>
  </main>
  <script>
    const result = document.getElementById("result");
    async function post(path, body) {
      result.textContent = "Working...";
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      result.textContent = JSON.stringify(await res.json(), null, 2);
    }
    document.getElementById("createAdmin").onclick = () => post("/api/super/customer-admins", {
      superAdminKey: superKey1.value.trim(),
      adminId: newAdminId.value.trim(),
      name: newAdminName.value.trim(),
      adminKey: newAdminKey.value.trim()
    });
    document.getElementById("createApp").onclick = () => post("/api/super/apps", {
      superAdminKey: superKey2.value.trim(),
      appKey: newAppKey.value.trim(),
      name: newAppName.value.trim(),
      ownerAdminId: ownerAdminId.value.trim(),
      url: initialUrl.value.trim()
    });
    document.getElementById("saveUrl").onclick = () => post("/api/admin/apps/" + encodeURIComponent(appKey.value.trim()) + "/url", {
      adminId: adminId.value.trim(),
      adminKey: adminKey.value.trim(),
      url: url.value.trim()
    });
  </script>
</body>
</html>`;
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  if (req.method === "GET" && pathname === "/") {
    return sendHtml(res, adminPage());
  }

  const appConfigMatch = pathname.match(/^\/api\/apps\/([^/]+)$/);
  if (req.method === "GET" && appConfigMatch) {
    const appKey = decodeURIComponent(appConfigMatch[1]);
    const data = await readData();
    const app = data.apps[appKey];
    if (!app) return sendJson(res, 404, { error: "Unknown app_key" });
    return sendJson(res, 200, publicApp(appKey, app));
  }

  const registerUserMatch = pathname.match(/^\/api\/apps\/([^/]+)\/users\/register$/);
  if (req.method === "POST" && registerUserMatch) {
    const appKey = decodeURIComponent(registerUserMatch[1]);
    const body = await readBody(req);
    const data = await readData();
    const app = data.apps[appKey];
    if (!app) return sendJson(res, 404, { error: "Unknown app_key" });
    if (!isValidId(body.deviceId)) return sendJson(res, 400, { error: "Invalid deviceId" });

    const userKey = `${appKey}:${body.deviceId}`;
    const existing = data.endUsers[userKey];
    data.endUsers[userKey] = {
      deviceId: body.deviceId,
      appKey,
      firstSeenAt: existing ? existing.firstSeenAt : now(),
      lastSeenAt: now(),
    };
    await writeData(data);
    return sendJson(res, 200, { ok: true, appKey, deviceId: body.deviceId });
  }

  if (req.method === "GET" && pathname === "/api/super/overview") {
    const data = await readData();
    const superAdminKey = requestUrl.searchParams.get("superAdminKey");
    if (!hasSuperAdminAccess(data, superAdminKey)) {
      return sendJson(res, 403, { error: "Invalid super admin key" });
    }
    return sendJson(res, 200, buildOverview(data));
  }

  if (req.method === "POST" && pathname === "/api/super/customer-admins") {
    const body = await readBody(req);
    const data = await readData();
    if (!hasSuperAdminAccess(data, body.superAdminKey)) {
      return sendJson(res, 403, { error: "Invalid super admin key" });
    }
    if (!isValidId(body.adminId)) return sendJson(res, 400, { error: "Invalid customer admin id" });
    if (!body.adminKey || String(body.adminKey).length < 8) {
      return sendJson(res, 400, { error: "adminKey must be at least 8 characters" });
    }

    const existing = data.customerAdmins[body.adminId];
    data.customerAdmins[body.adminId] = {
      id: body.adminId,
      name: body.name || body.adminId,
      role: "customer_admin",
      adminKeyHash: hashSecret(body.adminKey),
      appKeys: existing ? existing.appKeys : [],
      createdAt: existing ? existing.createdAt : now(),
      updatedAt: now(),
    };
    data.platform.updatedAt = now();
    await writeData(data);
    return sendJson(res, 200, { ok: true, role: "customer_admin", adminId: body.adminId });
  }

  if (req.method === "POST" && pathname === "/api/super/apps") {
    const body = await readBody(req);
    const data = await readData();
    if (!hasSuperAdminAccess(data, body.superAdminKey)) {
      return sendJson(res, 403, { error: "Invalid super admin key" });
    }
    if (!isValidId(body.appKey)) return sendJson(res, 400, { error: "Invalid app_key" });
    if (!data.customerAdmins[body.ownerAdminId]) {
      return sendJson(res, 404, { error: "Unknown owner customer admin" });
    }

    try {
      const existing = data.apps[body.appKey];
      data.apps[body.appKey] = {
        appKey: body.appKey,
        name: body.name || body.appKey,
        ownerAdminId: body.ownerAdminId,
        url: normalizeUrl(body.url),
        createdBy: "super_admin",
        createdAt: existing ? existing.createdAt : now(),
        updatedAt: now(),
      };
      const owner = data.customerAdmins[body.ownerAdminId];
      if (!owner.appKeys.includes(body.appKey)) owner.appKeys.push(body.appKey);
      owner.updatedAt = now();
      data.platform.updatedAt = now();
      await writeData(data);
      return sendJson(res, 200, { ok: true, appKey: body.appKey, ownerAdminId: body.ownerAdminId, url: data.apps[body.appKey].url });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const adminAppsMatch = pathname.match(/^\/api\/admin\/apps$/);
  if (req.method === "GET" && adminAppsMatch) {
    const data = await readData();
    const adminId = requestUrl.searchParams.get("adminId");
    const adminKey = requestUrl.searchParams.get("adminKey");
    const admin = data.customerAdmins[adminId];
    if (!admin || admin.adminKeyHash !== hashSecret(adminKey)) {
      return sendJson(res, 403, { error: "Invalid customer admin credentials" });
    }
    return sendJson(res, 200, {
      adminId,
      role: "customer_admin",
      apps: admin.appKeys.map((appKey) => publicApp(appKey, data.apps[appKey])).filter(Boolean),
    });
  }

  const updateUrlMatch = pathname.match(/^\/api\/admin\/apps\/([^/]+)\/url$/);
  if (req.method === "POST" && updateUrlMatch) {
    const appKey = decodeURIComponent(updateUrlMatch[1]);
    if (!isValidId(appKey)) return sendJson(res, 400, { error: "Invalid app_key" });

    const body = await readBody(req);
    const data = await readData();
    const app = data.apps[appKey];
    if (!app) return sendJson(res, 404, { error: "Unknown app_key" });
    if (!hasCustomerAdminAccess(data, app, body.adminId, body.adminKey)) {
      return sendJson(res, 403, { error: "Invalid customer admin credentials for this app" });
    }

    try {
      app.url = normalizeUrl(body.url);
      app.updatedAt = now();
      await writeData(data);
      return sendJson(res, 200, { ok: true, role: "customer_admin", adminId: app.ownerAdminId, appKey, url: app.url, updatedAt: app.updatedAt });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Web1 config server running on http://${HOST}:${PORT}`);
  console.log(`Local test: http://localhost:${PORT}/api/apps/demo`);
});
