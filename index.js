// Importujemy potrzebne biblioteki
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

// Tworzymy instancje naszych narzędzi
const prisma = new PrismaClient(); // To jest nasz "pilot" do bazy danych
const app = express(); // To jest nasza aplikacja-serwer

// Konfiguracja serwera
app.use(cors()); // Pozwala na komunikację z frontendem z innej domeny/portu
app.use(express.json()); // Umożliwia serwerowi odczytywanie danych w formacie JSON

// ===================================
// === Definicje naszych API Endpointów ===
// ===================================

/*
 * Endpoint [GET] /api/filament-types
 * Zwraca listę wszystkich zdefiniowanych typów filamentów.
 */
app.get('/api/filament-types', async (req, res) => {
  try {
    // Używamy Prismy, aby znaleźć wszystkie rekordy w tabeli FilamentType
    const filamentTypes = await prisma.filamentType.findMany({
      orderBy: {
        createdAt: 'desc', // Sortujemy od najnowszych
      },
    });
    // Odsyłamy znalezione dane jako odpowiedź w formacie JSON
    res.json(filamentTypes);
  } catch (error) {
    console.error("Błąd podczas pobierania typów filamentów:", error);
    res.status(500).json({ error: "Nie udało się pobrać danych" });
  }
});

/*
 * Endpoint [POST] /api/filament-types
 * Tworzy nowy typ filamentu na podstawie danych przesłanych z frontendu.
 */
app.post('/api/filament-types', async (req, res) => {
  try {
    // Odczytujemy dane, które przysłał nam frontend w ciele zapytania
    const { manufacturer, material, color } = req.body;

    // Używamy Prismy, aby stworzyć nowy rekord w tabeli FilamentType
    const newFilamentType = await prisma.filamentType.create({
      data: {
        manufacturer: manufacturer,
        material: material,
        color: color,
      },
    });
    // Odsyłamy nowo utworzony obiekt jako potwierdzenie
    res.status(201).json(newFilamentType);
  } catch (error) {
    console.error("Błąd podczas tworzenia typu filamentu:", error);
    res.status(500).json({ error: "Nie udało się zapisać danych" });
  }
});


// ===================================
// === Uruchomienie serwera ===
// ===================================

// Nasłuchujemy na porcie zdefiniowanym przez Render.com, a lokalnie na 3001
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});