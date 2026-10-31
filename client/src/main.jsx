import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Account, ForgotPassword, Login, ResetPassword, Signup } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { SubscriptionDetail, SubscriptionForm, SubscriptionList } from './pages/Subscriptions.jsx';
import { InvoiceDetail, InvoiceList, Payments } from './pages/Invoices.jsx';
import { Customers, Discounts, Plans, Products, Taxes, Templates } from './pages/Catalog.jsx';
import { Operations, Users } from './pages/Admin.jsx';

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  const I = ['admin', 'staff'], A = ['admin'];
  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={user.role === 'customer' ? <SubscriptionList /> : <Dashboard />} />
        <Route path="subscriptions" element={<SubscriptionList />} />
        <Route path="subscriptions/new" element={<Guard roles={I}><SubscriptionForm /></Guard>} />
        <Route path="subscriptions/:id" element={<SubscriptionDetail />} />
        <Route path="subscriptions/:id/edit" element={<Guard roles={I}><SubscriptionForm /></Guard>} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="payments" element={<Payments />} />
        <Route path="customers" element={<Guard roles={I}><Customers /></Guard>} />
        <Route path="products" element={<Guard roles={I}><Products /></Guard>} />
        <Route path="plans" element={<Guard roles={I}><Plans /></Guard>} />
        <Route path="templates" element={<Guard roles={I}><Templates /></Guard>} />
        <Route path="taxes" element={<Guard roles={A}><Taxes /></Guard>} />
        <Route path="discounts" element={<Guard roles={A}><Discounts /></Guard>} />
        <Route path="users" element={<Guard roles={A}><Users /></Guard>} />
        <Route path="operations" element={<Guard roles={A}><Operations /></Guard>} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter><AuthProvider><ToastProvider><App /></ToastProvider></AuthProvider></BrowserRouter>
  </React.StrictMode>,
);
