# Web1 Shell App

This sample uses a 3-level role tree:

```text
Super Admin -> Customer Admin -> End User
```

- Super Admin controls the whole platform.
- Customer Admin can create/manage only the apps assigned by the Super Admin.
- End User only opens the completed app and reads the URL configured for that app key.

## Default Test Values

```text
Super Admin Key: super-root-1234
Customer Admin ID: customer-demo
Customer Admin Key: admin-demo-1234
App Key: demo
```

## Run Config Server

```powershell
D:\web1\start-server.bat
```

Or:

```powershell
cd D:\web1\server
node server.js
```

Open the web admin page:

```text
http://localhost:3000
```

## End User App Flow

```text
App starts
-> user enters app key, for example demo
-> app asks server for that app key URL
-> WebView opens the returned website
```

Public API used by normal users:

```text
GET /api/apps/demo
```

## Customer Admin Flow

Customer Admin can update only their own app URL:

```text
POST /api/admin/apps/demo/url
```

Body:

```json
{
  "adminId": "customer-demo",
  "adminKey": "admin-demo-1234",
  "url": "https://example.com"
}
```

## Super Admin Flow

Super Admin can create/update customer admin accounts:

```text
POST /api/super/customer-admins
```

Super Admin can create/update apps and assign an owner customer admin:

```text
POST /api/super/apps
```

## Distribution Note

Local IP addresses are only for PC testing. For real APK distribution, deploy `server/` to a public HTTPS server and set:

```java
public static final String API_BASE_URL = "https://your-api-domain.com";
```

## Railway + PostgreSQL

Recommended production-like setup:

```text
Android APK
-> Railway Node.js API
-> Railway PostgreSQL DB
```

Railway PostgreSQL provides `DATABASE_URL`. When this variable exists, the server automatically uses PostgreSQL. Without `DATABASE_URL`, it falls back to local `server/data.json` for PC testing.

Railway steps:

```text
1. Push D:\web1 to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add PostgreSQL to the same Railway project.
4. Make sure the Node service has DATABASE_URL from the PostgreSQL service.
5. Deploy the Node service.
6. Open the Railway public domain, for example https://your-app.up.railway.app.
7. Change Android Config.java API_BASE_URL to that Railway domain.
8. Rebuild the APK.
```

Super Admin overview endpoint:

```text
GET /api/super/overview?superAdminKey=super-root-1234
```

It returns totals by customer admin:

```text
customer admin count
app count
end user count
apps per customer admin
users per app
```
