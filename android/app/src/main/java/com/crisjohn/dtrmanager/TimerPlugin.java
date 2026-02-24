package com.crisjohn.dtrmanager;

import android.content.Intent;
import android.os.Build;

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

    public void trigger(String eventName) {
        if (getBridge() != null) {
            notifyListeners(eventName, new JSObject());
        }
    }

    @PluginMethod
    public void startTimer(PluginCall call) {
        String timerText = call.getString("timerText", "00:00:00");
        Boolean isPausedObj = call.getBoolean("isPaused");
        boolean isPaused = isPausedObj != null ? isPausedObj : false;

        Intent intent = new Intent(getContext(), TimerService.class);
        intent.setAction("START");
        intent.putExtra("time", timerText);
        intent.putExtra("isPaused", isPaused);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopTimer(PluginCall call) {
        Intent intent = new Intent(getContext(), TimerService.class);
        intent.setAction("STOP");
        getContext().startService(intent);
        call.resolve();
    }
}
