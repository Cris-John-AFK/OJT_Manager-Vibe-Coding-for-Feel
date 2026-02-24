package com.crisjohn.dtrmanager;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.appcompat.app.AlertDialog;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIF_PERMISSION_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(TimerPlugin.class);
        
        android.widget.Toast.makeText(this, "DTR App Ready", android.widget.Toast.LENGTH_SHORT).show();

        // 1. Notification Permission (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIF_PERMISSION_CODE);
            }
        }

        // 2. Battery Optimization (Background Persistence)
        requestBatteryOptimizationExemption();
        
        // 3. Display Over Other Apps (Banner Visibility)
        requestOverlayPermission();
    }

    private void requestBatteryOptimizationExemption() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        String pkg = getPackageName();
        if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
            new AlertDialog.Builder(this)
                .setTitle("⚡ Background Running")
                .setMessage("To keep the timer running when your screen is off, please allow background running on the next screen.")
                .setPositiveButton("Configure", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + pkg));
                    startActivity(intent);
                }).show();
        }
    }

    private void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                new AlertDialog.Builder(this)
                    .setTitle("🔔 Enable Notification Banners")
                    .setMessage("To show the timer stopwatch at the top of your screen, please enable 'Display over other apps' for DTR Manager.")
                    .setPositiveButton("Enable Now", (dialog, which) -> {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    })
                    .setCancelable(false)
                    .show();
            }
        }
    }
}
