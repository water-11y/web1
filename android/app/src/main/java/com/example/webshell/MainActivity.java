package com.example.webshell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class MainActivity extends Activity {
    private static final String PREFS = "web1";
    private static final String KEY_APP_KEY = "app_key";
    private static final String KEY_DEVICE_ID = "device_id";

    private WebView webView;
    private ProgressBar progressBar;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildLayout();
        configureWebView();

        String appKey = prefs.getString(KEY_APP_KEY, "");
        if (appKey.isEmpty()) {
            askAppKey();
        } else {
            loadConfiguredUrl(appKey);
        }
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progressBar = new ProgressBar(this);

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        root.addView(webView, webParams);

        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(96, 96);
        progressParams.gravity = Gravity.CENTER;
        root.addView(progressBar, progressParams);

        setContentView(root);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyMobileFit(view);
            }
        });
        webView.setBackgroundColor(Color.WHITE);
    }

    private void applyMobileFit(WebView view) {
        view.evaluateJavascript(mobileFitScript(), null);
    }

    private String mobileFitScript() {
        return "(function(){"
                + "try{"
                + "var meta=document.querySelector('meta[name=\"viewport\"]');"
                + "if(!meta){meta=document.createElement('meta');meta.name='viewport';document.head.appendChild(meta);}"
                + "meta.setAttribute('content','width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');"
                + "var old=document.getElementById('web1-mobile-fit-style');if(old){old.remove();}"
                + "var style=document.createElement('style');style.id='web1-mobile-fit-style';"
                + "style.textContent='html,body{max-width:100%!important;overflow-x:hidden!important;}"
                + "*{box-sizing:border-box!important;}"
                + "img,video,canvas,iframe,embed,object{max-width:100%!important;height:auto!important;}"
                + "table{max-width:100%!important;display:block!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;}"
                + "pre,code{white-space:pre-wrap!important;word-break:break-word!important;}"
                + "input,select,textarea,button{max-width:100%!important;}"
                + "a,span,p,li,div{word-break:break-word;overflow-wrap:anywhere;}';"
                + "document.head.appendChild(style);"
                + "function fitWideNodes(){"
                + "var w=Math.max(document.documentElement.clientWidth,window.innerWidth||0);"
                + "var nodes=document.body?document.body.querySelectorAll('div,section,article,main,header,footer,nav,ul,ol,form') : [];"
                + "for(var i=0;i<nodes.length;i++){var el=nodes[i];if(el.scrollWidth>w*1.15){el.style.maxWidth='100%';el.style.overflowX='auto';}}"
                + "}"
                + "fitWideNodes();setTimeout(fitWideNodes,500);setTimeout(fitWideNodes,1500);"
                + "}catch(e){}"
                + "})();";
    }

    private void askAppKey() {
        final EditText input = new EditText(this);
        input.setHint("demo");
        input.setText("demo");
        input.setSingleLine(true);

        new AlertDialog.Builder(this)
                .setTitle("App Key")
                .setMessage("Enter the app key from your admin.")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("Start", (dialog, which) -> {
                    String appKey = input.getText().toString().trim();
                    if (appKey.length() < 2) {
                        toast("Enter the app key again.");
                        askAppKey();
                        return;
                    }
                    prefs.edit().putString(KEY_APP_KEY, appKey).apply();
                    loadConfiguredUrl(appKey);
                })
                .show();
    }

    private void loadConfiguredUrl(String appKey) {
        progressBar.setVisibility(ProgressBar.VISIBLE);
        new Thread(() -> {
            try {
                String endpoint = Config.API_BASE_URL + "/api/apps/" + Uri.encode(appKey);
                HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestMethod("GET");

                int status = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(),
                        StandardCharsets.UTF_8
                ));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) response.append(line);

                if (status < 200 || status >= 300) {
                    throw new IllegalStateException(response.toString());
                }

                JSONObject json = new JSONObject(response.toString());
                String targetUrl = json.getString("url");
                runOnUiThread(() -> {
                    progressBar.setVisibility(ProgressBar.GONE);
                    webView.loadUrl(targetUrl);
                });
                registerEndUser(appKey);
            } catch (Exception error) {
                runOnUiThread(() -> {
                    progressBar.setVisibility(ProgressBar.GONE);
                    toast("Could not load URL settings.");
                    showRetryDialog(error.getMessage());
                });
            }
        }).start();
    }

    private void registerEndUser(String appKey) {
        new Thread(() -> {
            try {
                String deviceId = prefs.getString(KEY_DEVICE_ID, "");
                if (deviceId.isEmpty()) {
                    deviceId = UUID.randomUUID().toString();
                    prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
                }

                String endpoint = Config.API_BASE_URL + "/api/apps/" + Uri.encode(appKey) + "/users/register";
                HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);

                String body = "{\"deviceId\":\"" + deviceId + "\"}";
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
                connection.getResponseCode();
                connection.disconnect();
            } catch (Exception ignored) {
                // User counting should never block opening the website.
            }
        }).start();
    }

    private void showRetryDialog(String detail) {
        new AlertDialog.Builder(this)
                .setTitle("Connection Failed")
                .setMessage(detail == null ? "Check the config server." : detail)
                .setPositiveButton("Retry", (dialog, which) -> {
                    String appKey = prefs.getString(KEY_APP_KEY, "");
                    if (appKey.isEmpty()) askAppKey();
                    else loadConfiguredUrl(appKey);
                })
                .setNegativeButton("Change App Key", (dialog, which) -> askAppKey())
                .show();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add("Admin");
        menu.add("Change App Key");
        menu.add("Reload");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        String title = String.valueOf(item.getTitle());
        if ("Admin".equals(title)) {
            startActivity(new Intent(this, AdminActivity.class));
            return true;
        }
        if ("Change App Key".equals(title)) {
            prefs.edit().remove(KEY_APP_KEY).apply();
            askAppKey();
            return true;
        }
        if ("Reload".equals(title)) {
            String appKey = prefs.getString(KEY_APP_KEY, "");
            if (appKey.isEmpty()) askAppKey();
            else loadConfiguredUrl(appKey);
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
