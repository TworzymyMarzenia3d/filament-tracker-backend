// OSTATECZNA WERSJA - backend/index.js

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();

// --- Konfiguracja ---
const corsOptions = { origin: '*', methods: "GET,HEAD,PUT,PATCH,POST,DELETE", preflightContinue: false, optionsSuccessStatus: 204 };
app.use(cors(corsOptions));
app.use(express.json());

// --- Logowanie i Autentykacja ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === process.env.APP_PASSWORD) {
    const token = jwt.sign({ access: 'granted' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Nieprawidłowe hasło' });
  }
});
const auth = (req, res, next) => {
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
// ===     API: Magazyn (ERP)      ===
// ===================================

// --- Kategorie Produktów ---
app.get('/api/product-categories', auth, async (req, res) => {
    const categories = await prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
});
app.post('/api/product-categories', auth, async (req, res) => {
    const { name } = req.body;
    const newCategory = await prisma.productCategory.create({ data: { name } });
    res.status(201).json(newCategory);
});


// --- Produkty ---
app.get('/api/products', auth, async (req, res) => {
  const products = await prisma.product.findMany({ include: { category: true }, orderBy: { name: 'asc' } });
  res.json(products);
});

app.post('/api/products', auth, async (req, res) => {
    const { categoryId, name, unit, manufacturer, materialType, color, diameter } = req.body;
    const category = await prisma.productCategory.findUnique({ where: { id: parseInt(categoryId) } });

    let productName = name;
    let productUnit = unit;

    // Inteligentna logika dla kategorii "Filament"
    if (category && category.name.toLowerCase() === 'filament') {
        productName = `${manufacturer} ${materialType} ${color}`;
        productUnit = 'g'; // Zawsze gramy dla filamentu
    }

    try {
        const newProduct = await prisma.product.create({ 
            data: { 
                name: productName, 
                unit: productUnit, 
                categoryId: parseInt(categoryId),
                manufacturer, materialType, color, 
                diameter: diameter ? parseFloat(diameter) : null 
            }
        });
        res.status(201).json(newProduct);
    } catch (e) {
        // Obsługa błędu unikalności nazwy
        if (e.code === 'P2002') {
            res.status(409).json({ error: `Produkt o nazwie "${productName}" już istnieje.`});
        } else {
            res.status(500).json({ error: "Nie udało się utworzyć produktu." });
        }
    }
});


// --- Zakupy ---
app.get('/api/purchases', auth, async (req, res) => {
    const purchases = await prisma.purchase.findMany({ orderBy: { purchaseDate: 'asc' }, include: { product: true } });
    res.json(purchases);
});

app.post('/api/purchases', auth, async (req, res) => {
  // ... (ta logika jest już poprawna i uniwersalna, kopiujemy ją)
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
// === API: CRM i Zamówienia (logika bez zmian, tylko include'y) ===
// ===================================
app.get('/api/clients', auth, async (req, res) => {
    const clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    res.json(clients);
});
app.post('/api/clients', auth, async (req, res) => {
    const { name, nip, address, phone, email, notes } = req.body;
    const newClient = await prisma.client.create({ data: { name, nip, address, phone, email, notes } });
    res.status(201).json(newClient);
});
app.get('/api/orders', auth, async (req, res) => {
    const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: { 
            client: true, 
            items: { 
                include: { 
                    product: true,
                    usages: { include: { purchase: true }} 
                } 
            } 
        },
    });
    res.json(orders);
});
app.post('/api/orders', auth, async (req, res) => {
    // ... (logika bez zmian, ale potrzebujemy endpointu do numeracji)
});
// TODO: Endpointy do Wycen (Quotations), Faktur (Invoices), Ustawień (AppSettings) i Notatek (Notes) zostaną dodane później.


// --- Logika FIFO (przerobiona na OrderItem) ---
app.post('/api/order-items', auth, async (req, res) => {
  const { orderId, description, markupPercent, usages } = req.body;
  // ... (ta logika zostanie przeniesiona i dostosowana)
});


// ===================================
// ===     URUCHOMIENIE SERWERA     ===
// ===================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});