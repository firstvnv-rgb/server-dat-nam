const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let players = {};
let currentStage = 1;
let mushrooms = [];
let starSpawned = false;

// Phần thưởng theo từng cửa (Hiển thị khi kết thúc cửa)
const STAGE_REWARDS = {
    1: { nam: "Nhận được lời tỏ tình từ bạn Nữ ❤️", nu: "Tát yêu bạn Nam 5 cái 🖐️ HOẶC Nhận 1 vật phẩm gia tăng sức mạnh!" },
    2: { nam: "Được mời bạn Nữ đi ăn tối 🍲", nu: "Nhận 10.000đ 💵 + Tát yêu bạn Nam 10 cái 🖐️" },
    3: { nam: "Được cầm tay bạn Nữ 🤝", nu: "Nhận 50.000đ 💵 HOẶC Tát yêu bạn Nam 20 cái 🖐️" },
    4: { nam: "Được ôm bạn Nữ 🤗", nu: "Nhận 500.000đ 💵 HOẶC Tát yêu bạn Nam 50 cái 🖐️" },
    5: { nam: "Được thơm bạn Nữ 💋", nu: "Nhận 500.000đ 💵 + 1 Bó hoa rực rỡ 💐" },
    6: { nam: "Được HÔN bạn Nữ 👑❤️", nu: "Nhận 1.000.000đ 💵 + 1 Bó hoa siêu to 💐" }
};

io.on('connection', (socket) => {
    console.log(`Người chơi kết nối: ${socket.id}`);

    // Khi người chơi chọn Giới tính (Nam/Nữ)
    socket.on('joinGame', (data) => {
        let gender = data.gender; // 'nam' hoặc 'nu'
        
        players[socket.id] = {
            id: socket.id,
            gender: gender,
            name: gender === 'nam' ? 'Mạnh Hùng (Nam)' : 'Vũ Hiền (Nữ)',
            x: gender === 'nam' ? 50 : 350,
            y: gender === 'nam' ? 50 : 550,
            speed: 4,
            power: 1, // Bán kính nổ của nấm
            lives: 3,
            isX2: false
        };

        // Gửi thông tin phòng cho tất cả máy
        io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });
    });

    // Xử lý di chuyển công bằng thời gian thực
    socket.on('move', (pos) => {
        if (players[socket.id]) {
            players[socket.id].x = pos.x;
            players[socket.id].y = pos.y;
            socket.broadcast.emit('playerMoved', { id: socket.id, x: pos.x, y: pos.y });
        }
    });

    // Đặt nấm độc / nấm nổ
    socket.on('placeMushroom', (data) => {
        if (!players[socket.id]) return;
        let p = players[socket.id];
        
        let newMushroom = {
            id: Math.random().toString(),
            x: data.x,
            y: data.y,
            owner: socket.id,
            power: p.isX2 ? p.power * 2 : p.power,
            timer: 3000 // 3 giây nổ
        };
        
        mushrooms.push(newMushroom);
        io.emit('mushroomPlaced', newMushroom);

        // Kích hoạt đồng hồ đếm ngược nổ nấm độc
        setTimeout(() => {
            mushrooms = mushrooms.filter(m => m.id !== newMushroom.id);
            io.emit('mushroomExploded', newMushroom);
        }, 3000);
    });

    // Khi có người trúng nấm nổ hoặc nhặt được Ngôi sao hy vọng
    socket.on('hitEvent', (data) => {
        let targetId = data.targetId;
        if (players[targetId]) {
            if (data.type === 'hitMushroom') {
                players[targetId].lives--;
                // Phạt giảm sức mạnh khi trúng nấm
                if (players[targetId].power > 1) players[targetId].power--;
                if (players[targetId].speed > 3) players[targetId].speed -= 0.5;

                io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });

                // Kiểm tra phân định thắng thua của Cửa
                if (players[targetId].lives <= 0) {
                    let winner = Object.values(players).find(p => p.id !== targetId);
                    let winnerGender = winner ? winner.gender : 'Hòa';
                    
                    // Thưởng tăng sức mạnh cho ván sau
                    if (winner) {
                        winner.power++;
                        winner.speed += 0.5;
                    }

                    io.emit('stageOver', { 
                        winner: winnerGender, 
                        reward: winner ? STAGE_REWARDS[currentStage][winnerGender] : "",
                        currentStage
                    });
                }
            } else if (data.type === 'pickupStar') {
                // Nhặt ngôi sao hy vọng x2 sức mạnh ở hiệp 2 trở đi
                players[targetId].isX2 = true;
                io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });
                
                // Hết tác dụng x2 sau 10 giây
                setTimeout(() => {
                    if (players[targetId]) {
                        players[targetId].isX2 = false;
                        io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });
                    }
                }, 10000);
            }
        }
    });

    // Chuyển sang ván đấu/cửa tiếp theo
    socket.on('nextStage', () => {
        currentStage++;
        if (currentStage > 6) currentStage = 1; // Hết 6 ván quay về ván 1
        
        // Reset trạng thái nhân vật cho cửa mới nhưng giữ lại chỉ số cường hóa sức mạnh
        starSpawned = false;
        for (let id in players) {
            players[id].lives = 3;
            players[id].isX2 = false;
            players[id].x = players[id].gender === 'nam' ? 50 : 350;
            players[id].y = players[id].gender === 'nam' ? 50 : 550;
        }
        mushrooms = [];
        io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('updateRoom', { players, currentStage, mushrooms, stageRewards: STAGE_REWARDS[currentStage] });
    });
});

http.listen(process.env.PORT || 3000, () => {
    console.log('Máy chủ Game Online đang chạy mượt mà!');
});
