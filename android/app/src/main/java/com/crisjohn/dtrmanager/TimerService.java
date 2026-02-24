package com.crisjohn.dtrmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

public class TimerService extends Service {
    private static final String CHANNEL_ID = "TimerChannel";
    private static final int NOTIF_ID = 101;
    private MediaSessionCompat mediaSession;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        mediaSession = new MediaSessionCompat(this, "TimerService");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("PAUSE");
            }
            @Override
            public void onPause() {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("PAUSE");
            }
            @Override
            public void onStop() {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("TIMEOUT");
                stopForeground(true);
                stopSelf();
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if ("START".equals(action)) {
                String text = intent.getStringExtra("time");
                boolean isPaused = intent.getBooleanExtra("isPaused", false);
                
                PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                        .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_STOP);
                stateBuilder.setState(isPaused ? PlaybackStateCompat.STATE_PAUSED : PlaybackStateCompat.STATE_PLAYING, -1, 1.0f);
                mediaSession.setPlaybackState(stateBuilder.build());

                Notification notification = createNotification(text, isPaused);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIF_ID, notification);
                }
            } else if ("STOP".equals(action)) {
                stopForeground(true);
                stopSelf();
            } else if ("PAUSE_H".equals(action)) {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("PAUSE");
            } else if ("RESUME_H".equals(action)) {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("PAUSE");
            } else if ("TIMEOUT_H".equals(action)) {
                if (TimerPlugin.instance != null) TimerPlugin.instance.trigger("TIMEOUT");
                stopForeground(true);
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    private Notification createNotification(String text, boolean isPaused) {
        Intent playPause = new Intent(this, TimerService.class).setAction(isPaused ? "RESUME_H" : "PAUSE_H");
        PendingIntent pPlayPause = PendingIntent.getService(this, 100, playPause, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent timeout = new Intent(this, TimerService.class).setAction("TIMEOUT_H");
        PendingIntent pTimeout = PendingIntent.getService(this, 101, timeout, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pApp = PendingIntent.getActivity(this, 1, appIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        androidx.media.app.NotificationCompat.MediaStyle mediaStyle = new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1); // Play/Pause and Stop

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Active Session: " + text)
                .setContentText("DTR Manager Tracker")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pApp)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setStyle(mediaStyle)
                .addAction(new NotificationCompat.Action(
                        isPaused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
                        isPaused ? "Resume" : "Pause",
                        pPlayPause
                ))
                .addAction(new NotificationCompat.Action(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        "Time Out",
                        pTimeout
                ))
                .build();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        mediaSession.release();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Active Timer", NotificationManager.IMPORTANCE_LOW);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
