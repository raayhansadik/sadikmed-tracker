# 💊 SadikMed Tracker

A modern, responsive, and secure medication adherence tracking web application designed to help patients manage daily prescriptions, schedule doses, and track compliance.

- **🌐 Live Production URL:** [https://sadikmed.vercel.app](https://sadikmed.vercel.app)
- **📦 Repository:** [https://github.com/raayhansadik/sadikmed-tracker](https://github.com/raayhansadik/sadikmed-tracker)

---

## ✨ Features

- **Medication Scheduling**: Supports once daily, multiple times a day, weekly, and as-needed (PRN) dosing frequencies.
- **Interactive Calendar & Log**: Visual adherence calendar with daily checklist, dose acknowledgment, and compliance tracking.
- **Secure Authentication**:
  - One-Time Password (OTP) 6-digit email verification for new account registration.
  - Fast, direct password sign-in for registered users (no OTP required on repeat logins).
  - Dedicated memory-hard scrypt password hashing (RFC 7914 / OWASP recommended standard) with unique 16-byte (128-bit) cryptographic salts and timing-safe server-side verification.
  - Transparent backward compatibility and automatic in-flight upgrade for legacy credentials.
- **Automated Email Reminders**: Fast email notifications and verification codes powered by Google SMTP with connection pooling and CDN-hosted branding.
- **Offline-Ready & Persistent**: Dual storage architecture leveraging browser `localStorage` and server-side JSON synchronization for fast, reliable access across devices.
- **Responsive 3D UI**: Clean mobile-first design with custom modal dialogs, dose calculators, and dark/light contrast optimization.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 *(zero bulky frontend framework dependencies)*
- **Backend**: Node.js HTTP Server & Vercel Serverless Functions
- **Email Service**: Nodemailer via Google Gmail SMTP (`noreply.sadikmed@gmail.com`)
- **Hosting & CI/CD**: Vercel Serverless Platform with automated GitHub deployments

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Git

### 2. Clone & Install
```bash
git clone https://github.com/raayhansadik/sadikmed-tracker.git
cd sadikmed-tracker
npm install
```

### 3. Environment Variables
Create a `.env.local` file in the project root:
```env
GMAIL_USER="noreply.sadikmed@gmail.com"
GMAIL_PASS="your_16_char_google_app_password"
OTP_SECRET="your_custom_hmac_secret"
```

### 4. Run Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```text
├── assets/                  # Brand assets (3D logos, avatars, icons)
├── data/                    # Server-side user and adherence records
│   ├── sadikmed-users.json  # Registered user profiles (salted hashes)
│   ├── sadikmed-data.json   # Patient medication schedules & logs
│   └── email-config.json    # SMTP dispatcher configurations
├── sadikmed.html            # Main single-page application (SPA)
├── server.js                # Node.js backend router & SMTP dispatcher
├── vercel.json              # Vercel deployment rewrites & serverless bundle config
└── package.json             # Dependencies and scripts
```

---

## 👨‍💻 Author

**Md Rayhan Sadik**  
Founder & Developer · [Clipora](https://sadikmed.vercel.app)
