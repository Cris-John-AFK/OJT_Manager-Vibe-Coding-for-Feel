package com.crisjohn.dtrmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

public class TimerService extends Service {
    private static final String CHANNEL_ID = "dtr_system_chrono_v8";
    private static final int NOTIF_ID = 8008;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        
        String action = intent.getAction();
        if ("START".equals(action)) {
            // Vibrate to alert user that service is actually starting
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(100);

            Notification notification = buildSystemNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID, notification);
            }
        } else if ("STOP".equals(action)) {
            stopForeground(true);
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    private Notification buildSystemNotification() {
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pApp = PendingIntent.getActivity(this, 0, appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // SYSTEM CHRONOMETER: We let the Android OS handle the counting.
        // This is 100% stable and used by the System Clock app.
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("DTR Session In Progress")
                .setContentText("Tap to return to app")
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setUsesChronometer(true)
                .setWhen(System.currentTimeMillis()) 
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_ALARM)
                .setColor(Color.BLUE)
                .setFullScreenIntent(pApp, true) // Force banner on Oppo
                .setContentIntent(pApp)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Active DTR Tracker",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}
