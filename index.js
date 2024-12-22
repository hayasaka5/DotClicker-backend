const express = require('express');
const WebSocket = require('ws');
const cors = require('cors')
const app = express();
require('dotenv').config();

const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN,  // Используем переменную окружения
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));

// Запуск HTTP сервера
const server = app.listen(process.env.PORT || 8080, () => {
  console.log('Сервер запущен на http://localhost:8080');
});

// Создание WebSocket сервера
const wss = new WebSocket.Server({
  server, // Используем тот же сервер, что и для express
  verifyClient: (info, done) => {
    // Проверка заголовка Origin, чтобы разрешить подключение только с указанного домена
    const origin = info.origin;
    if (origin === process.env.ALLOWED_ORIGIN) {  // Используем переменную окружения
      done(true); // Разрешаем соединение
    } else {
      done(false, 403, 'Forbidden'); // Отклоняем соединение с другого домена
    }
  },
});

// Хранение данных о комнатах и игроках
let rooms = new Map();
let playersConnections = new Map();

// Генерация уникального ID комнаты
function generateRoomID() {
  return Math.floor(Math.random() * 100000000000);
}

// Создание целей
function createTargets() {
  return Array.from({ length: 3000 }, () => [  // Генерация 10 целей
    Math.floor(Math.random() * 100),        // x: от 0 до 500
    Math.floor(Math.random() * 100)         // y: от 0 до 500
  ]);
}


// Удаление игрока из комнаты
function leaveRoom(player, roomID) {
  if (rooms.has(roomID)) {
    let room = rooms.get(roomID);
    room.players = room.players.filter(p => p.name !== player);
    console.log(`Игрок ${player} покинул комнату ${roomID}`);
    
    if (room.players.length === 0) {
      rooms.delete(roomID);
      console.log(`Комната ${roomID} удалена`);
    }
  }
}

// Функция для отправки сообщений всем игрокам в комнате
function broadcastToRoom(roomID, message) {
  if (!rooms.has(roomID)) {
    console.error(`Комната ${roomID} не найдена`);
    return;
  }

  const room = rooms.get(roomID);
  room.players.forEach(player => {
    const connection = Array.from(playersConnections.entries()).find(([ws, data]) =>
      data.player === player.name && data.roomID === roomID
    );

    if (connection) {
      const [ws] = connection;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  });
}

// Обработка WebSocket-соединений
wss.on('connection', (ws) => {
  console.log('Новое WebSocket подключение');
  let player = null;
  let roomID = null;

  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      player = parsedMessage.player;
      roomID = parseInt(parsedMessage.roomID);
      const room = rooms.get(roomID);
      switch (parsedMessage.method) {
        case 'createRoom':
          roomID = generateRoomID();
          rooms.set(roomID, {
            roomID,
            players: [{ name: player, time: null, score: null, isReady: false }],
            targets:[],
          });
          playersConnections.set(ws, { player, roomID });
          ws.send(JSON.stringify({ method: 'createRoom', room: rooms.get(roomID), status: 'success' }));
          console.log(`Комната ${roomID} создана`);
          break;
          case 'finishGame':
            console.log(parsedMessage.newScore+'newScore')
            console.log(parsedMessage.newTime+'newTime')
            let finishPlayer=room.players.find(p=>p.name===player)
            finishPlayer.score=parsedMessage.newScore
            finishPlayer.time=parsedMessage.newTime
            finishPlayer.isReady=false
            broadcastToRoom(roomID, { method: 'changeRoom', status: 'success', room });
            console.log(`finish game score:${finishPlayer.score} time:${finishPlayer.time}`)
            break
        case 'joinRoom':
          const targetRoom = rooms.get(roomID);
          if (targetRoom) {
            if (!targetRoom.players.find(p => p.name === player)) {
              if(room.players.length===4){
                ws.send(JSON.stringify({status:'error',message:'The room is full'}))
              }else{
                targetRoom.players.push({ name: player, time: null, score: null, isReady: false });
              playersConnections.set(ws, { player, roomID });
              broadcastToRoom(roomID, { method: 'changeRoom', status: 'success', room: targetRoom });
              console.log(`Игрок ${player} присоединился к комнате ${roomID}`);
              }
            }
            else {
              ws.send(JSON.stringify({ status: 'error', message: 'This name is already taken' }));
            }
          } else {
            ws.send(JSON.stringify({ status: 'error', message: 'There are no room with this ID' }));
          }
          break;
          case 'setNotReadyAll':

            break
        case 'switchIsReady':
         
          if (room) {
            const targetPlayer = room.players.find(p => p.name === player);
            if (targetPlayer) {
              targetPlayer.isReady = !targetPlayer.isReady;
              room.targets=createTargets()
              broadcastToRoom(roomID, { method: 'changeRoom', status: 'success', room });
              console.log(`Игрок ${player} теперь ${targetPlayer.isReady ? 'готов' : 'не готов'}`);
              let readyPlayers = room.players.filter(p=>p.isReady===true).length
              if(readyPlayers===room.players.length){
                room.players.forEach((p)=>p.isReady=false)
                broadcastToRoom(roomID, { method: 'changeRoom', status: 'success', room });
              }
            }
          }
          break;

        case 'leaveRoom':
          leaveRoom(player, roomID);
          ws.send(JSON.stringify({ status: 'success', message: `Игрок ${player} покинул комнату ${roomID}` }));
          break;

        default:
          ws.send(JSON.stringify({ status: 'error', message: 'Неизвестный метод' }));
          break;
      }
    } catch (err) {
      console.error('Ошибка при обработке сообщения:', err);
      ws.send(JSON.stringify({ status: 'error', message: 'Ошибка в формате сообщения' }));
    }
  });

  ws.on('close', () => {
    console.log('Соединение закрыто');
    if (player && roomID) {
      leaveRoom(player, roomID);
      playersConnections.delete(ws);

      // Если комната пустая, удаляем её
      const room = rooms.get(roomID);
      if (room && room.players.length === 0) {
        rooms.delete(roomID);
        console.log(`Комната ${roomID} удалена, так как в ней не осталось игроков`);
      }

      broadcastToRoom(roomID, { method: 'changeRoom', room });
    }
  });
});

// HTTP маршруты
app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/getScript', (req, res) => {
  const script = Array.from({ length: 3000 }, () => Math.floor(Math.random() * 100));
  console.log('Скрипт отправлен');
  res.send(script);
});

app.get('/favicon.ico', (req, res) => res.sendStatus(204));
