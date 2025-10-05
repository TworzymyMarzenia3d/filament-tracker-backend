// Plik: backend/index.js (Wersja dla Finalnej Architektury)

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();

const corsOptions = { origin: '*', methods: "GET,HEAD,PUT,PATCH,POST,DELETE" };
app.use(cors(corsOptions));
app.use(express.json());

// === LOGOWANIE I AUTENTYKACJA (bez zmian) ===
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.APP_PASSWORD) {
    const token = jwt.sign({ access: 'granted' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Nieprawidłowe hasło' });
  }
});
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.status(401).json({ error: 'Brak autoryzacji' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token nieprawidłowy' });
    req.user = user;
    next();
  });
};

// ===================================
// ===     API: MODUŁ MAGAZYNU     ===
// ===================================

// --- Kategorie Produktów ---
app.get('/api/product-categories', authMiddleware, async (req, res) => {
    const categories = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
});
app.post('/api/product-categories', authMiddleware, async (req, res) => {
    const { name } = req.body;
    const newCategory = await prisma.productCategory.create({ data: { name } });
    res.status(201).json(newCategory);
});

// --- Produkty (Uniwersalne) ---
app.get('/api/products', authMiddleware, async (req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: 'asc' }, include: { category: true } });
  res.json(products);
});
app.post('/api/products', authMiddleware, async (req, res) => {
  const { name, unit, categoryId, lowStockAlert } = req.body;
  const newProduct = await prisma.product.create({ 
      data: { name, unit, categoryId: parseInt(categoryId), lowStockAlert: lowStockAlert ? parseFloat(lowStockAlert) : null } 
  });
  res.status(201).json(newProduct);
});

// --- Zakupy (Uniwersalne) ---
app.get('/api/purchases', authMiddleware, async (req, res) => {
    const purchases = await prisma.purchase.findMany({
        orderBy: { purchaseDate: 'asc' }, include: { product: true },
    });
    res.json(purchases);
});
app.post('/api/purchases', authMiddleware, async (req, res) => {
  const { productId, purchaseDate, initialQuantity, price, currency, exchangeRate, vendorName } = req.body;
  const priceFloat = parseFloat(price);
  const quantityFloat = parseFloat(initialQuantity);
  const rateFloat = parseFloat(exchangeRate);
  const priceInPLN = priceFloat * rateFloat;
  const costPerUnitInPLN = priceInPLN / quantityFloat;
  const newPurchase = await prisma.purchase.create({
    data: {
      productId: parseInt(productId),
      purchaseDate: new Date(purchaseDate || Date.now()),
      vendorName,
      initialQuantity: quantityFloat, currentQuantity: quantityFloat,
      price: priceFloat, currency: currency || 'PLN',
      exchangeRate: rateFloat, priceInPLN: priceInPLN,
      costPerUnitInPLN: costPerUnitInPLN,
    },
  });
  res.status(201).json(newPurchase);
});


// ===================================
// ===     API: MODUŁ CRM          ===
// ===================================

// --- Klienci ---
app.get('/api/clients', authMiddleware, async (req, res) => {
    const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    res.json(clients);
});
app.post('/api/clients', authMiddleware, async (req, res) => {
    const { name, nip, address, phone, email, notes } = req.body;
    const newClient = await prisma.client.create({ data: { name, nip, address, phone, email, notes } });
    res.status(201).json(newClient);
});

// TODO: API dla Zamówień, Wycen i Fakturowania zostanie dodane w kolejnych krokach.

// ===================================
// ===     URUCHOMIENIE SERWERA     ===
// ===================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});