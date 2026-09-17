const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customer');
const pharmacyRoutes = require('./routes/pharmacy');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' })); // raised for base64 store-photo uploads
app.use(session({
  secret: 'pillpoint-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\nPillPoint is running: http://localhost:${PORT}\n`);
});
