# MotiFi · Personalized Finance SaaS Platform

**MotiFi** is an intelligent personal finance platform designed to help users align their financial habits with their life goals and emotional well-being. It blends budgeting, behavioral tracking, and AI-enhanced coaching into one cohesive experience.

MotiFi is built with scalability and multi-platform support in mind — delivering a unified experience across **web**, **mobile**, and future smart device integrations.

---

## 📦 Overview

|              | Description                               |
|--------------|-------------------------------------------|
| **Type**     | SaaS (Personal Finance & Productivity)    |
| **Status**   | Active development (MVP stage)            |
| **Frontend** | Vite + React (TypeScript)                 |
| **Backend**  | Python (Flask)                            |
| **Mobile**   | React Native (planned)                    |
| **Auth**     | Firebase Auth (planned)                   |
| **Billing**  | Stripe (planned)                          |

---

## ✨ Key Features

- 🧠 Value-based budgeting system
- 📊 Real-time feedback based on emotional and financial data
- 🧘‍♀️ Mood & habit tracking integrated into budget planning
- 🔁 Data syncing across web and mobile
- 📦 Secure user auth and encrypted data storage
- 🔐 Role-based permission system (admin, user)
- 🤖 GPT-powered spending insights and coaching (planned)

---

## 🛠️ Tech Stack

| Layer     | Technology                     |
|-----------|--------------------------------|
| Frontend  | Vite, React, TypeScript, CSS Modules |
| Backend   | Flask, Flask-CORS, Python 3.9  |
| Auth      | Firebase Auth (planned)        |
| Payments  | Stripe (planned)               |
| Deployment | Vercel (frontend), Render (backend) |
| Monitoring | LogRocket, Sentry (planned)   |

---

## 🧭 Architecture

- client-vite/   –> Web frontend (React + Vite)
- server/        –> REST API (Flask)
- docs/          –> Architecture, API, and onboarding guides
- mobile/        –> React Native app (coming soon)

---

## 🧪 Local Development

### Prerequisites:
- Node.js ≥ 18.x
- Python ≥ 3.9
- Git + SSH set up

### Frontend:
```bash
cd client-vite
npm install
npm run dev 
```
## Backend: 
```cd server
python3 -m venv venv
source venv/bin/activate
pip install flask flask-cors
python app.py
```

## 📈 Roadmap

We’re building MotiFi in phases to deliver value fast and iterate with users.

| Status | Feature                                      | Target |
|--------|----------------------------------------------|--------|
| ✅     | Web budget form with backend API             | v0.1   |
| ✅     | GitHub repo with SSH and structured README   | v0.1   |
| ⏳     | Mood & habit tracking module                 | v0.2   |
| ⏳     | Firebase Authentication (Sign in / Sign up)  | v0.2   |
| 🔜     | Stripe billing & subscription plans          | v0.3   |
| 🔜     | GPT-powered budget recommendations           | v0.3   |
| 🔜     | Mobile app (React Native with Expo)          | v0.4   |
| 🧪     | Unit/integration testing (Vitest + Pytest)   | v0.4   |
| 🧭     | Admin dashboard for user & revenue insights  | v0.5   |

## 📄 License

**Proprietary – All rights reserved**

© 2025 MotiFi Inc. This software is not open source and may not be copied, modified, or distributed without prior written permission from the author.

For licensing inquiries, contact: licensing@motifi.app

## Contact & Team 
Lead Developer: **Huynh Quang Bao Anh**

Github: @hqbaoanh

Email: huynhquang.baoanh@gmail.com 

