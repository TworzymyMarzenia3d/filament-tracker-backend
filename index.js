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
// Plik: backend/index.js (tylko ten jeden endpoint)

app.post('/api/purchases', authenticateToken, async (req, res) => {
  try {
    const { filamentTypeId, purchaseDate, initialWeight, price, currency, exchangeRate } = req.body;

    if (!filamentTypeId || !initialWeight || !price || !exchangeRate) {
      return res.status(400).json({ error: 'Brak wszystkich wymaganych danych.' });
    }
    
    // Konwertujemy dane wejściowe na liczby
    const priceFloat = parseFloat(price);
    const weightInt = parseInt(initialWeight);
    const rateFloat = parseFloat(exchangeRate);

    // Obliczamy cenę w PLN
    const priceInPLN = priceFloat * rateFloat;
    // Obliczamy koszt za gram w PLN
    const costPerGramInPLN = priceInPLN / weightInt;

    const newPurchase = await prisma.purchase.create({
      data: {
        filamentTypeId: parseInt(filamentTypeId),
        purchaseDate: new Date(purchaseDate || Date.now()),
        initialWeight: weightInt,
        currentWeight: weightInt,
        price: priceFloat, // Cena w oryginalnej walucie
        currency: currency || 'PLN',
        exchangeRate: rateFloat, // Zapisujemy kurs
        priceInPLN: priceInPLN, // Zapisujemy przeliczoną cenę
        costPerGramInPLN: costPerGramInPLN, // Zapisujemy ustandaryzowany koszt
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
// Plik: backend/index.js (wklej przed app.listen)

/*
 * Endpoint [POST] /api/print-jobs
 * Rejestruje nowe zlecenie wydruku i odlicza materiał zgodnie z FIFO.
 */
app.post('/api/print-jobs', authenticateToken, async (req, res) => {
  const { jobName, usages } = req.body; // Oczekujemy nazwy zlecenia i tablicy zużyć

  if (!jobName || !usages || !Array.isArray(usages) || usages.length === 0) {
    return res.status(400).json({ error: 'Nieprawidłowe dane zlecenia.' });
  }

  try {
    // === Transakcja bazodanowa - klucz do bezpieczeństwa danych ===
    // Jeśli cokolwiek pójdzie nie tak, wszystkie zmiany zostaną cofnięte.
    const result = await prisma.$transaction(async (tx) => {
      let totalJobCost = 0;
      const createdUsages = [];

      // 1. Stwórz wstępny wpis dla zlecenia
      const printJob = await tx.printJob.create({
        data: { jobName, totalCostInPLN: 0 }, // Zaczynamy z kosztem 0
      });

      // 2. Przetwórz każde zgłoszone zużycie
      for (const usage of usages) {
        let remainingWeightToLog = parseInt(usage.weightToUse);
        if (isNaN(remainingWeightToLog) || remainingWeightToLog <= 0) continue;

        // Znajdź wszystkie dostępne szpule danego typu, posortowane od najstarszej (FIFO!)
        const availableSpools = await tx.purchase.findMany({
          where: {
            filamentTypeId: parseInt(usage.filamentTypeId),
            currentWeight: { gt: 0 }, // Tylko te, na których coś zostało
          },
          orderBy: { purchaseDate: 'asc' },
        });

        if (availableSpools.length === 0) {
          throw new Error(`Brak dostępnego filamentu typu ID: ${usage.filamentTypeId}`);
        }

        // 3. Odejmuj wagę z kolejnych szpul
        for (const spool of availableSpools) {
          const weightFromThisSpool = Math.min(spool.currentWeight, remainingWeightToLog);

          // Zaktualizuj wagę na szpuli
          await tx.purchase.update({
            where: { id: spool.id },
            data: { currentWeight: spool.currentWeight - weightFromThisSpool },
          });

          // Oblicz koszt tej porcji
          const costForThisPortion = weightFromThisSpool * spool.costPerGramInPLN;
          totalJobCost += costForThisPortion;

          // Zapisz wpis o zużyciu
          createdUsages.push({
              printJobId: printJob.id,
              purchaseId: spool.id,
              usedWeight: weightFromThisSpool,
              calculatedCost: costForThisPortion,
          });

          remainingWeightToLog -= weightFromThisSpool;
          if (remainingWeightToLog <= 0) break; // Przetworzyliśmy całe zużycie dla tej pozycji
        }

        // Sprawdź, czy wystarczyło filamentu
        if (remainingWeightToLog > 0) {
          throw new Error(`Niewystarczająca ilość filamentu w magazynie dla typu ID: ${usage.filamentTypeId}. Zabrakło ${remainingWeightToLog}g.`);
        }
      }

      // 4. Stwórz wszystkie wpisy o zużyciu naraz
      await tx.printUsage.createMany({
        data: createdUsages,
      });

      // 5. Zaktualizuj zlecenie ostatecznym, zsumowanym kosztem
      const finalPrintJob = await tx.printJob.update({
          where: { id: printJob.id },
          data: { totalCostInPLN: totalJobCost },
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
// === Uruchomienie serwera        ===
// ===================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});