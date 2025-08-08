import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './home/HomePage';
import BudgetForm from './form/BudgetForm';

const AppRoutes = () => (
    <Router>
        <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/form" element={<BudgetForm />} />
        </Routes>
    </Router>
);

export default AppRoutes; 