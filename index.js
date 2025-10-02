// Plik: backend/index.js

// ===================================
// ===         IMPORTY             ===
// ===================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

// ===================================
// ===    INICJALIZACJA APLIKACJI    ===
// ===================================
const prisma = new PrismaClient();
const app = express();

// ===================================
// ===     KONFIGURACJA CORS        ===
// ===================================
const corsOptions = {
  origin: '*',
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// ===================================
// ===     KONFIGURACJA SERWERA     ===
// ===================================
app.use(express.json());

// ===================================
// === LOGOWANIE I AUTENTYKACJA    ===
// ===================================
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.APP_PASSWORD) {
    const token = jwt.sign({ access: 'granted' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Nieprawidłowe hasło' });
  }
});

const authenticateToken = (req, res, next) => {
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
// ===      API: MAGAZYN           ===
// ===================================

// --- Filament Types ---
app.get('/api/filament-types', authenticateToken, async (req, res) => {
  const filamentTypes = await prisma.filamentType.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(filamentTypes);
});
app.post('/api/filament-types', authenticateToken, async (req, res) => {
  const { manufacturer, material, color } = req.body;
  const newFilamentType = await prisma.filamentType.create({ data: { manufacturer, material, color } });
  res.status(201).json(newFilamentType);
});

// --- Purchases ---
app.get('/api/purchases', authenticateToken, async (req, res) => {
    const purchases = await prisma.purchase.findMany({
        orderBy: { purchaseDate: 'asc' }, include: { filamentType: true },
    });
    res.json(purchases);
});
app.post('/api/purchases', authenticateToken, async (req, res) => {
  const { filamentTypeId, purchaseDate, initialWeight, price, currency, exchangeRate } = req.body;
  const priceFloat = parseFloat(price);
  const weightInt = parseInt(initialWeight);
  const rateFloat = parseFloat(exchangeRate);
  const priceInPLN = priceFloat * rateFloat;
  const costPerGramInPLN = priceInPLN / weightInt;
  const newPurchase = await prisma.purchase.create({
    data: {
      filamentTypeId: parseInt(filamentTypeId),
      purchaseDate: new Date(purchaseDate || Date.now()),
      initialWeight: weightInt, currentWeight: weightInt,
      price: priceFloat, currency: currency || 'PLN',
      exchangeRate: rateFloat, priceInPLN: priceInPLN,
      costPerGramInPLN: costPerGramInPLN,
    },
  });
  res.status(201).json(newPurchase);
});


// ===================================
// ===         API: CRM             ===
// ===================================

// --- Clients ---
app.get('/api/clients', authenticateToken, async (req, res) => {
    const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    res.json(clients);
});
app.post('/api/clients', authenticateToken, async (req, res) => {
    const { name, contact, notes } = req.body;
    const newClient = await prisma.client.create({ data: { name, contact, notes } });
    res.status(201).json(newClient);
});

// --- Orders ---
app.get('/api/orders', authenticateToken, async (req, res) => {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { client: true, printJobs: true },
    });
    res.json(orders);
});
app.post('/api/orders', authenticateToken, async (req, res) => {
    const { orderName, clientId, status } = req.body;
    const newOrder = await prisma.order.create({
        data: {
            orderName,
            clientId: parseInt(clientId),
            status: status || 'Nowe',
        }
    });
    res.status(201).json(newOrder);
});


// --- Print Jobs (Logika FIFO) ---
app.post('/api/print-jobs', authenticateToken, async (req, res) => {
  const { orderId, description, usages } = req.body;
  if (!orderId || !usages || !Array.isArray(usages) || usages.length === 0) {
    return res.status(400).json({ error: 'Nieprawidłowe dane zlecenia.' });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      let totalJobCost = 0;
      const createdUsages = [];
      const printJob = await tx.printJob.create({
        data: { description, orderId: parseInt(orderId), totalCostInPLN: 0 },
      });
      for (const usage of usages) {
        let remainingWeightToLog = parseInt(usage.weightToUse);
        if (isNaN(remainingWeightToLog) || remainingWeightToLog <= 0) continue;
        const availableSpools = await tx.purchase.findMany({
          where: { filamentTypeId: parseInt(usage.filamentTypeId), currentWeight: { gt: 0 } },
          orderBy: { purchaseDate: 'asc' },
        });
        if (availableSpools.length === 0) throw new Error(`Brak filamentu typu ID: ${usage.filamentTypeId}`);
        for (const spool of availableSpools) {
          const weightFromThisSpool = Math.min(spool.currentWeight, remainingWeightToLog);
          await tx.purchase.update({
            where: { id: spool.id }, data: { currentWeight: spool.currentWeight - weightFromThisSpool },
          });
          const costForThisPortion = weightFromThisSpool * spool.costPerGramInPLN;
          totalJobCost += costForThisPortion;
          createdUsages.push({
              printJobId: printJob.id, purchaseId: spool.id,
              usedWeight: weightFromThisSpool, calculatedCost: costForThisPortion,
          });
          remainingWeightToLog -= weightFromThisSpool;
          if (remainingWeightToLog <= 0) break;
        }
        if (remainingWeightToLog > 0) throw new Error(`Niewystarczająca ilość filamentu w magazynie dla typu ID: ${usage.filamentTypeId}. Zabrakło ${remainingWeightToLog}g.`);
      }
      await tx.printUsage.createMany({ data: createdUsages });
      const finalPrintJob = await tx.printJob.update({
          where: { id: printJob.id }, data: { totalCostInPLN: totalJobCost },
      });
      return finalPrintJob;
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Błąd podczas przetwarzania zlecenia FIFO:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// ===     URUCHOMIENIE SERWERA     ===
// ===================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});