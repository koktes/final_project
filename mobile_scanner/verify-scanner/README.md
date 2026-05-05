# VerifyPay Scanner

VerifyPay Scanner is a mobile application designed to scan and verify payment receipts from various Ethiopian financial providers. It acts as the mobile front-end for the Payment Verification API, allowing users to quickly validate transactions via QR codes, barcodes, or manual entry.

## 🚀 Features

*   **Universal Scanner:** Scan QR codes and barcodes to extract transaction references instantly.
*   **Multi-Provider Support:** Automatically detects the payment provider based on the reference format. Supported providers include:
    *   Commercial Bank of Ethiopia (CBE)
    *   Telebirr
    *   Dashen Bank
    *   Bank of Abyssinia (BOA)
    *   CBE Birr
    *   M-Pesa
*   **Manual Entry Fallback:** Easily enter transaction details manually if scanning fails, with support for provider-specific fields like Account Suffix and Phone Number.
*   **Secure Authentication:** Connects to your backend API using secure API keys, persistently stored on the device.
*   **Real-time Results:** Displays detailed verification results, including status, payer/receiver info, amounts, service fees, and transaction channels.
*   **Sleek UI:** Built with Expo, utilizing a beautiful, themed design (Light & Dark mode support) for a premium user experience.

## 🏗️ Project Structure

The application is built using Expo and React Native, structured around file-based routing with `expo-router`.

```text
src/
├── app/
│   ├── _layout.tsx          # Root layout with auth guard logic
│   ├── index.tsx            # Initial auth redirect
│   ├── login.tsx            # API key entry screen
│   └── (app)/
│       ├── _layout.tsx      # Main app stack navigator
│       ├── scan.tsx         # Camera scanner and manual entry sheet
│       ├── results.tsx      # Verification results display
│       └── settings.tsx     # Provider list and disconnect option
├── components/
│   ├── scanner.tsx          # Core camera scanner component
│   ├── themed-text.tsx      # Reusable text component with theme integration
│   └── themed-view.tsx      # Reusable view component with theme integration
├── constants/
│   ├── api.ts               # API endpoints and configuration
│   └── theme.ts             # App-wide color, spacing, and font tokens
├── context/
│   └── auth.tsx             # Authentication context (AsyncStorage integration)
├── hooks/
│   ├── use-color-scheme.ts  # Device color scheme hook
│   └── use-theme.ts         # Theme hook resolving current colors
└── services/
    └── api.ts               # API service layer (verification & health check)
```

## ⚙️ Prerequisites

*   Node.js (v18 or newer recommended)
*   npm, yarn, or pnpm
*   Expo CLI (`npm install -g expo-cli`)
*   Expo Go app on your physical device (for testing), or an Android/iOS emulator setup.
*   A running instance of the **Payment Verification API** (backend).

## 🚀 Getting Started

1.  **Clone or navigate to the project directory:**
    Ensure you are in the `mobile_scanner/verify-scanner` directory.

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Configure API URL:**
    Open `src/constants/api.ts` and update the `API_BASE_URL` to point to your backend API instance.
    *   For Android Emulator connecting to local backend: `http://10.0.2.2:3000`
    *   For physical device testing: Use your computer's local IP address (e.g., `http://192.168.1.X:3000`)
    *   For production: Use your deployed API URL.

4.  **Start the Expo Development Server:**
    ```bash
    npm start
    ```

5.  **Run the App:**
    *   Press `a` in the terminal to open on an Android emulator.
    *   Press `i` to open on an iOS simulator.
    *   Scan the QR code shown in the terminal using the Expo Go app on your physical device.

## 🔐 Authentication (API Key)

To use the app, you need a valid API key from your backend.
1. Generate an API key using the backend's web dashboard (typically `http://localhost:5173`) or via its admin API endpoint.
2. Launch the mobile app and paste the API key on the Login screen to connect.

## 🛠️ Scripts

*   `npm start`: Starts the Expo development server.
*   `npm run android`: Starts the server and attempts to open the app on an Android emulator or connected device.
*   `npm run ios`: Starts the server and attempts to open the app on an iOS simulator.
*   `npm run lint`: Runs ESLint to check for code issues.

## 📦 Key Dependencies

*   `expo` & `expo-router`: Core framework and routing.
*   `expo-camera`: Hardware camera integration for scanning.
*   `@react-native-async-storage/async-storage`: Persistent storage for API keys.
*   `expo-linear-gradient`: UI enhancements.

## 📄 License

This project is part of the Payment Verification ecosystem. See the root project for license details.
