package com.crisjohn.dtrmanager;

import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Timer")
public class TimerPlugin extends Plugin {
    public static TimerPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    private void runOnUiThreadToast(String msg) {
        new Handler(Looper.getMainLooper()).post(() -> 
            Toast.makeText(getContext(), "DTR Plugin: " + msg, Toast.LENGTH_SHORT).show()
        );
    }

    @PluginMethod
    public void startNativeTimer(PluginCall call) {
        String time = call.getString("time", "00:00:00");
        boolean isPaused = call.getBoolean("isPaused", false);

        runOnUiThreadToast("Start Signal Received");

        try {
            Intent intent = new Intent(getContext(), TimerService.class);
            intent.setAction("START");
            intent.putExtra("time", time);
            intent.putExtra("isPaused", isPaused);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            runOnUiThreadToast("Error: " + e.getMessage());
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void updateTimer(PluginCall call) {
        String time = call.getString("time", "00:00:00");
        boolean isPaused = call.getBoolean("isPaused", false);

        try {
            Intent intent = new Intent(getContext(), TimerService.class);
            intent.setAction("UPDATE");
            intent.putExtra("time", time);
            intent.putExtra("isPaused", isPaused);
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {}
    }

    @PluginMethod
    public void stopTimer(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), TimerService.class);
            intent.setAction("STOP");
            getContext().startService(intent);
            call.resolve();
        } catch (Exception e) {}
    }

    public void trigger(String event) {
        JSObject ret = new JSObject();
        ret.put("type", event);
        notifyListeners("timerEvent", ret);
    }
}
