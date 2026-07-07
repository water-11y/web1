package com.example.webshell;

public final class Config {
    private Config() {}

    // Current PC Wi-Fi IP for local emulator/device testing.
    // For real distribution, replace this with your public HTTPS server.
    public static final String API_BASE_URL = "http://192.168.0.33:3000";
}
