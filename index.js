// Importujemy potrzebne biblioteki
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Nowa biblioteka do tokenów
const { PrismaClient } = require('@prisma/client');
require('dotenv').config(); // Upewniamy się, że zmienne z .env są dostępne

// Tworzymy instancje naszych narzędzi
const prisma = new PrismaClient();
const app = express();

// Konfiguracja serwera
// Importujemy biblioteki...
const express = require('express');
const cors = require('cors');
// ...

// Tworzymy instancje...
const prisma = new PrismaClient();
const app = express();

// === NOWA, ROZBUDOWANA KONFIGURACJA CORS ===
const corsOptions = {
  origin: '*', // Pozwala na zapytania z dowolnej domeny (idealne do testów)
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE", // Akceptowane metody HTTP
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Upewniamy się, że zapytania OPTIONS działają poprawnie

app.use(express.json());

// ... reszta Twojego kodu (endpointy /api/login itd.) ...
app.use(express.json());

// ===================================
// === LOGOWANIE I AUTENTYKACJA    ===
// ===================================

/*
 * Endpoint [POST] /api/login
 * Służy do logowania użytkownika.
 */
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  // Sprawdzamy, czy hasło z frontendu zgadza się z tym na serwerze
  if (password && password === process.env.APP_PASSWORD) {
    // Hasło jest poprawne. Generujemy token JWT, który będzie ważny przez 7 dni.
    const token = jwt.sign(
      { access: 'granted' }, // Zawartość tokenu (payload)
      process.env.JWT_SECRET, // Tajny klucz do podpisu tokenu
      { expiresIn: '7d' }    // Czas ważności
    );
    // Odsyłamy token do frontendu
    res.json({ token });
  } else {
    // Hasło jest niepoprawne lub go nie ma.
    res.status(401).json({ error: 'Nieprawidłowe hasło' });
  }
});


/*
 * Middleware do weryfikacji tokenu
 * Ta funkcja będzie uruchamiana przed każdym chronionym endpointem.
 * Sprawdza, czy zapytanie zawiera poprawny i ważny token JWT.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Token jest przesyłany w nagłówku jako "Bearer TOKEN_STRING"
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    // Jeśli nie ma tokenu, odmawiamy dostępu
    return res.status(401).json({ error: 'Brak autoryzacji: token nie został dostarczony.' });
  }

  // Weryfikujemy, czy token jest poprawny i nie wygasł
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      // Jeśli token jest nieważny (np. wygasł lub jest sfałszowany), odmawiamy dostępu
      return res.status(403).json({ error: 'Brak autoryzacji: token jest nieprawidłowy.' });
    }
    // Jeśli wszystko jest ok, dołączamy dane użytkownika do zapytania i przechodzimy dalej
    req.user = user;
    next();
  });
};


// ===================================
// === Definicje API Endpointów    ===
// ===================================

/*
 * Endpoint [GET] /api/filament-types
 * Zwraca listę wszystkich zdefiniowanych typów filamentów.
 * Jest teraz chroniony przez middleware `authenticateToken`.
 */
app.get('/api/filament-types', authenticateToken, async (req, res) => {
  try {
    const filamentTypes = await prisma.filamentType.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(filamentTypes);
  } catch (error) {
    console.error("Błąd podczas pobierania typów filamentów:", error);
    res.status(500).json({ error: "Nie udało się pobrać danych" });
  }
});

/*
 * Endpoint [POST] /api/filament-types
 * Tworzy nowy typ filamentu.
 * Również jest chroniony przez middleware `authenticateToken`.
 */
app.post('/api/filament-types', authenticateToken, async (req, res) => {
  try {
    const { manufacturer, material, color } = req.body;
    const newFilamentType = await prisma.filamentType.create({
      data: {
        manufacturer,
        material,
        color,
      },
    });
    res.status(201).json(newFilamentType);
  } catch (error) {
    console.error("Błąd podczas tworzenia typu filamentu:", error);
    res.status(500).json({ error: "Nie udało się zapisać danych" });
  }
});
/*
 * Endpoint [POST] /api/purchases
 * Dodaje nowy zakup filamentu do bazy danych.
 */
app.post('/api/purchases', authenticateToken, async (req, res) => {
  try {
    // Odczytujemy dane z frontendu
    const { filamentTypeId, purchaseDate, initialWeight, price, currency } = req.body;

    // Prosta walidacja, żeby upewnić się, że mamy wszystkie dane
    if (!filamentTypeId || !initialWeight || !price) {
      return res.status(400).json({ error: 'Brak wszystkich wymaganych danych.' });
    }

    // Obliczamy koszt za gram
    const costPerGram = price / initialWeight;

    // Tworzymy nowy rekord w tabeli Purchase
    const newPurchase = await prisma.purchase.create({
      data: {
        filamentTypeId: parseInt(filamentTypeId), // Upewniamy się, że to liczba
        purchaseDate: new Date(purchaseDate || Date.now()), // Jeśli nie ma daty, użyj dzisiejszej
        initialWeight: parseInt(initialWeight),
        currentWeight: parseInt(initialWeight), // Na starcie waga aktualna = waga początkowa
        price: parseFloat(price),
        currency: currency || 'PLN', // Domyślna waluta
        costPerGram: costPerGram,
      },
    });

    res.status(201).json(newPurchase);
  } catch (error) {
    console.error("Błąd podczas dodawania zakupu:", error);
    res.status(500).json({ error: "Nie udało się zapisać zakupu." });
  }
});

/*
 * Endpoint [GET] /api/purchases
 * Pobiera listę wszystkich zakupów wraz z informacjami o typie filamentu.
 */
app.get('/api/purchases', authenticateToken, async (req, res) => {
    try {
        const purchases = await prisma.purchase.findMany({
            orderBy: {
                purchaseDate: 'asc', // Sortujemy od najstarszych (zgodnie z FIFO)
            },
            include: {
                filamentType: true, // Dołączamy powiązane dane o typie filamentu!
            },
        });
        res.json(purchases);
    } catch (error) {
        console.error("Błąd podczas pobierania zakupów:", error);
        res.status(500).json({ error: "Nie udało się pobrać zakupów." });
    }
});

// ===================================
// === Uruchomienie serwera        ===
// ===================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});