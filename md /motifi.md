src/
├── app/                   # Pages/routes
│   ├── home/              # Landing page ("/")
│   │   └── HomePage.tsx
│   ├── form/              # Budget form page ("/form")
│   │   └── BudgetForm.tsx
│   └── AppRoutes.tsx      # All route declarations
│
├── components/            # Reusable UI components
│   ├── Header.tsx
│   ├── Footer.tsx
│   └── CTAButton.tsx
│
├── layout/                # Layout wrappers (Navbar + Footer)
│   └── MainLayout.tsx
│
├── styles/                # Global styling
│   ├── tailwind.css
│   └── global.css
│
├── main.tsx               # App root entry
└── App.tsx                # Bootstrap (just routes/layout)