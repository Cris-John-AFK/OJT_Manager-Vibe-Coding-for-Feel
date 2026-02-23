# OJT DTR Manager

A premium OJT Daily Time Record (DTR) Manager built with Vite, Vanilla JS, and SQLite (SQL.js).

## Features
- **Premium Design**: Dark mode, glassmorphism, and smooth animations.
- **Splash Screen**: "Welcome to DTR manager by Cris John!" with custom loader.
- **Real-time Calculator**: Tracks hours rendered and remaining hours based on your goal.
- **SQLite Persistence**: Uses SQL.js for local database management, synced to browser storage.
- **Cross-Platform Storage**: Data persists in the app.
- **Export/Import**: Backup your SQLite database anytime.

## How to Run

### Web Version
```bash
npm install
npm run dev
```

### Android Version
1. The project is already initialized with **Capacitor**.
2. Open the `android` folder in **Android Studio**.
3. Build and run on your device.
4. To sync web changes to Android:
   ```bash
   npm run build
   npx cap sync
   ```

### EXE (Desktop) Version
```bash
npm run electron:start
```

## Technologies Used
- **Frontend**: HTML5, Vanilla CSS3, Javascript (Vite)
- **Icons**: Lucide
- **Database**: SQLite (SQL.js) + LocalForage
- **Packaging**: Capacitor (Android), Electron (EXE)

Created with ❤️ by Antigravity for Cris John.
