// Plik: backend/index.js (Wersja z obsługą atrybutów filamentu)

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

// === LOGOWANIE I AUTENTYKACJA ===
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
  const { 
    name, unit, categoryId, lowStockAlert, 
    filament_manufacturer, filament_material, filament_color, filament_diameter 
  } = req.body;
  const newProduct = await prisma.product.create({ 
      data: { 
          name, unit, 
          categoryId: parseInt(categoryId), 
          lowStockAlert: lowStockAlert ? parseFloat(lowStockAlert) : null,
          filament_manufacturer, filament_material, filament_color,
          filament_diameter: filament_diameter ? parseFloat(filament_diameter) : null
      } 
  });
  res.status(201).json(newProduct);
});

// --- Zakupy (Uniwersalne) ---
app.get('/api/purchases', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
app.post('/api/purchases', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
// Pełny kod dla pewności
app.get('/api/purchases', authMiddleware, async (req, res) => {
    const purchases = await prisma.purchase.findMany({ orderBy: { purchaseDate: 'asc' }, include: { product: true } });
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
      productId: parseInt(productId), purchaseDate: new Date(purchaseDate || Date.now()), vendorName,
      initialQuantity: quantityFloat, currentQuantity: quantityFloat,
      price: priceFloat, currency: currency || 'PLN',
      exchangeRate: rateFloat, priceInPLN: priceInPLN, costPerUnitInPLN: costPerUnitInPLN,
    },
  });
  res.status(201).json(newPurchase);
});


// ===================================
// ===     API: MODUŁ CRM          ===
// ===================================
app.get('/api/clients', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
app.post('/api/clients', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
app.get('/api/orders', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
app.post('/api/orders', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
// Pełny kod dla pewności
app.get('/api/clients', authMiddleware, async (req, res) => {
    const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    res.json(clients);
});
app.post('/api/clients', authMiddleware, async (req, res) => {
    const { name, nip, address, phone, email, notes } = req.body;
    const newClient = await prisma.client.create({ data: { name, nip, address, phone, email, notes } });
    res.status(201).json(newClient);
});
app.get('/api/orders', authMiddleware, async (req, res) => {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { client: true, printJobs: { include: { usages: { include: { purchase: { include: { product: true }}}}}}},
    });
    res.json(orders);
});
app.post('/api/orders', authMiddleware, async (req, res) => {
    const { orderName, clientId, status } = req.body;
    const newOrder = await prisma.order.create({
        data: { orderName, clientId: parseInt(clientId), status: status || 'Nowe' }
    });
    res.status(201).json(newOrder);
});
app.post('/api/print-jobs', authMiddleware, async (req, res) => { /* ... bez zmian ... */ });
// Pełny kod dla pewności
app.post('/api/print-jobs', authMiddleware, async (req, res) => {
  const { orderId, description, usages } = req.body;
  if (!orderId || !usages || !Array.isArray(usages) || usages.length === 0) return res.status(400).json({ error: 'Nieprawidłowe dane zlecenia.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      let totalJobCost = 0;
      const createdUsages = [];
      const printJob = await tx.printJob.create({ data: { description, orderId: parseInt(orderId), totalCostInPLN: 0 } });
      for (const usage of usages) {
        let remainingQuantityToLog = parseFloat(usage.quantityToUse);
        if (isNaN(remainingQuantityToLog) || remainingQuantityToLog <= 0) continue;
        const availableBatches = await tx.purchase.findMany({ where: { productId: parseInt(usage.productId), currentQuantity: { gt: 0 } }, orderBy: { purchaseDate: 'asc' } });
        if (availableBatches.length === 0) throw new Error(`Brak produktu w magazynie: ID ${usage.productId}`);
        for (const batch of availableBatches) {
          const quantityFromThisBatch = Math.min(batch.currentQuantity, remainingQuantityToLog);
          await tx.purchase.update({ where: { id: batch.id }, data: { currentQuantity: batch.currentQuantity - quantityFromThisBatch } });
          const costForThisPortion = quantityFromThisBatch * batch.costPerUnitInPLN;
          totalJobCost += costForThisPortion;
          createdUsages.push({ printJobId: printJob.id, purchaseId: batch.id, usedQuantity: quantityFromThisBatch, calculatedCost: costForThisPortion });
          remainingQuantityToLog -= quantityFromThisBatch;
          if (remainingQuantityToLog <= 0) break;
        }
        if (remainingQuantityToLog > 0) throw new Error(`Niewystarczająca ilość produktu w magazynie: ID ${usage.productId}. Zabrakło ${remainingQuantityToLog}.`);
      }
      await tx.printUsage.createMany({ data: createdUsages });
      const finalPrintJob = await tx.printJob.update({ where: { id: printJob.id }, data: { totalCostInPLN: totalJobCost } });
      return finalPrintJob;
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Błąd podczas przetwarzania zlecenia FIFO:", error);
    res.status(500).json({ error: error.message });
  }
});

// === URUCHOMIENIE SERWERA ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});