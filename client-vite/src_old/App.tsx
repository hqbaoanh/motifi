import React from 'react';
import AppRoutes from './app/AppRoutes';
import MainLayout from './layout/MainLayout';

function App() {
  return (
    <MainLayout> 
      <AppRoutes />
    </MainLayout>
  );
}

export default App; 