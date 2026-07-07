package com.example.webshell;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class AdminActivity extends Activity {
    private static final String PREFS = "web1";
    private static final String KEY_APP_KEY = "app_key";

    private EditText appKeyInput;
    private EditText adminIdInput;
    private EditText adminKeyInput;
    private EditText urlInput;
    private TextView resultView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildLayout();
    }

    private void buildLayout() {
        ScrollView scrollView = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 96, 32, 32);

        TextView title = new TextView(this);
        title.setText("Admin URL Settings");
        title.setTextSize(20);
        title.setPadding(0, 0, 0, 12);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String savedAppKey = prefs.getString(KEY_APP_KEY, "demo");

        appKeyInput = input("demo");
        appKeyInput.setText(savedAppKey.isEmpty() ? "demo" : savedAppKey);

        adminIdInput = input("customer-demo");
        adminIdInput.setText("customer-demo");

        adminKeyInput = input("admin-demo-1234");
        adminKeyInput.setText("admin-demo-1234");

        urlInput = input("https://example.com");

        Button saveButton = new Button(this);
        saveButton.setText("Save");
        saveButton.setOnClickListener(v -> saveUrl());

        resultView = new TextView(this);
        resultView.setText("Ready");
        resultView.setPadding(0, 24, 0, 0);

        root.addView(label("APP KEY"));
        root.addView(appKeyInput, matchWrap());
        root.addView(title, matchWrap());
        root.addView(label("Customer Admin ID"));
        root.addView(adminIdInput, matchWrap());
        root.addView(label("Customer Admin Key"));
        root.addView(adminKeyInput, matchWrap());
        root.addView(label("URL"));
        root.addView(urlInput, matchWrap());
        root.addView(saveButton, matchWrap());
        root.addView(resultView, matchWrap());
        scrollView.addView(root);
        setContentView(scrollView);
    }

    private TextView label(String text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(14);
        label.setPadding(0, 12, 0, 0);
        return label;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        return input;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private void saveUrl() {
        String appKey = appKeyInput.getText().toString().trim();
        String adminId = adminIdInput.getText().toString().trim();
        String adminKey = adminKeyInput.getText().toString().trim();
        String targetUrl = urlInput.getText().toString().trim();

        if (appKey.isEmpty() || adminId.isEmpty() || adminKey.isEmpty() || targetUrl.isEmpty()) {
            toast("Enter app key, customer admin ID, admin key, and URL.");
            return;
        }

        resultView.setText("Saving...");
        new Thread(() -> {
            try {
                String endpoint = Config.API_BASE_URL + "/api/admin/apps/" + appKey + "/url";
                HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("adminId", adminId);
                body.put("adminKey", adminKey);
                body.put("url", targetUrl);

                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                int status = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(),
                        StandardCharsets.UTF_8
                ));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) response.append(line);

                runOnUiThread(() -> resultView.setText(response.toString()));
            } catch (Exception error) {
                runOnUiThread(() -> resultView.setText(error.getMessage()));
            }
        }).start();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
