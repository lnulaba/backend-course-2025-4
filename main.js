const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const { Command } = require('commander');
const { XMLBuilder } = require('fast-xml-parser');

// Налаштування Commander.js
const program = new Command();
program
  .requiredOption('-i, --input <path>', 'шлях до файлу, який даємо для читання')
  .requiredOption('-h, --host <host>', 'адреса сервера')
  .requiredOption('-p, --port <port>', 'порт сервера', parseInt);

program.parse();
const options = program.opts();

// Перевірка існування файлу
if (!fs.existsSync(options.input)) {
  console.error('Cannot find input file');
  process.exit(1);
}

// Функція для читання та парсингу JSON файлу
function readJsonFile(filePath, callback) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      callback(err, null);
      return;
    }

    try {
      // Парсинг JSONL (JSON Lines) файлу
      const lines = data.trim().split('\n');
      const flights = lines.map(line => JSON.parse(line));
      callback(null, flights);
    } catch (parseErr) {
      callback(parseErr, null);
    }
  });
}

// Функція для фільтрації даних за параметрами
function filterFlights(flights, query) {
  let filtered = [...flights];

  // Фільтрація за мінімальним часом у повітрі
  if (query.airtime_min) {
    const minAirTime = parseInt(query.airtime_min);
    if (!isNaN(minAirTime)) {
      filtered = filtered.filter(flight => 
        flight.AIR_TIME && flight.AIR_TIME > minAirTime
      );
    }
  }

  return filtered;
}

// Функція для формування XML
function createXmlResponse(flights, query) {
  const includeDate = query.date === 'true';
  
  const flightData = flights.map(flight => {
    const flightObj = {
      air_time: flight.AIR_TIME,
      distance: flight.DISTANCE
    };

    if (includeDate) {
      flightObj.date = flight.FL_DATE;
    }

    return flightObj;
  });

  const xmlData = {
    flights: {
      flight: flightData
    }
  };

  const builder = new XMLBuilder({
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true
  });

  return builder.build(xmlData);
}

// Створення HTTP сервера
const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  // Парсинг URL та query параметрів
  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query;

  // Встановлення CORS заголовків
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    // Читання файлу асинхронно
    readJsonFile(options.input, (err, flights) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Помилка читання файлу: ${err.message}`);
        return;
      }

      try {
        // Фільтрація даних
        const filteredFlights = filterFlights(flights, query);

        // Обмеження кількості записів для великих наборів даних
        const maxRecords = 1000;
        const limitedFlights = filteredFlights.slice(0, maxRecords);

        // Створення XML відповіді
        const xmlResponse = createXmlResponse(limitedFlights, query);

        // Відправка відповіді
        res.writeHead(200, { 
          'Content-Type': 'application/xml; charset=utf-8',
          'X-Total-Records': filteredFlights.length.toString(),
          'X-Returned-Records': limitedFlights.length.toString()
        });
        res.end(xmlResponse);

      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Помилка обробки даних: ${error.message}`);
      }
    });
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Метод не підтримується');
  }
});

// Запуск сервера
server.listen(options.port, options.host, () => {
  console.log(`Сервер запущено на http://${options.host}:${options.port}`);
  console.log('Доступні параметри:');
  console.log('  ?date=true - відображати дату польоту');
  console.log('  ?airtime_min=X - фільтрувати за мінімальним часом у повітрі');
  console.log('  Приклад: http://${options.host}:${options.port}?date=true&airtime_min=340');
});

// Обробка сигналів завершення
process.on('SIGINT', () => {
  console.log('\nЗавершення роботи сервера...');
  server.close(() => {
    console.log('Сервер зупинено');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nЗавершення роботи сервера...');
  server.close(() => {
    console.log('Сервер зупинено');
    process.exit(0);
  });
});
