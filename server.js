const express = require('express');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2');
const multer = require('multer'); // ファイルアップロード用
const bcrypt = require('bcrypt'); // bcryptライブラリを追加
const session = require('express-session'); // セッション管理用
const app = express();
const PORT = 3000;

const BASE_DIR = path.join(__dirname, 'web');
const UPLOAD_DIR = path.join(BASE_DIR, 'pdf'); // PDF保存先

//DB接続
const connection = mysql.createConnection({
    host: '10.0.2.137',           //  MySQLサーバーのIP
    user: 'node_user',          //  作成したユーザー名
    password: 'Group10', //  設定したパスワード
    database: 'open_campus_db',     //  作成したデータベース名
    dateStrings: true // DATETIMEを文字列として受け取る
});

const databaseName = 'open_campus_db';

connection.connect(err => {
    if (err) {
        console.error('MySQL接続エラー: ' + err.stack);
        return;
    }
    console.log(`データベース「${databaseName}」に接続成功。`);
});

// 静的ファイル（HTML, PDF 等）を配信
app.use(express.static(BASE_DIR));
app.use(express.json()); // JSONリクエストボディを解析
app.use(express.urlencoded({ extended: true })); // URLエンコードされたデータを解析

// セッション設定
app.use(session({
    secret: 'your_secret_key', // セッションの暗号化キー
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // HTTPSを使用する場合はtrueに設定
}));

// ルート (/) へのGETリクエストが来た時の処理
app.get('/', (req, res) => {
    // DBから講義一覧を取得して toppage.html の指定箇所にボックスを挿入して返す
    connection.query('SELECT lecture_id, lecture_name FROM Mock_Lecture', (err, results) => {
        if (err) {
            console.error('DB取得エラー', err);
            return res.status(500).send('サーバーエラー');
        }

        fs.readFile(path.join(BASE_DIR, 'toppage.html'), 'utf8', (err, htmlContent) => {
            if (err) {
                console.error('toppage読み込みエラー', err);
                return res.status(500).send('サーバーエラー: ファイル読み込み失敗');
            }

            // 講義ボックス生成（リンクは lecture_id をクエリにして /lecture に飛ばす）
            const boxes = results.map(row => {
                // lecture_id は数値なのでそのまま埋める
                const id = row.lecture_id;
                const nameEscaped = String(row.lecture_name).replace(/"/g, '&quot;');
                return `<a href="/lecture?id=${id}"><button value="${nameEscaped}">${nameEscaped}</button></a><br>`;
            }).join('\n');

            // toppage.html の <div id="lecture-list"> の内部に boxes を挿入する
            const modifiedHtml = htmlContent.replace('<!--LECTURE_LIST_PLACEHOLDER-->', boxes);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(modifiedHtml);
        });
    });
});

//模擬授業詳細ページへ遷移するapi
app.get('/lecture', (req, res) => {
    // id を lecture_id（数値）として扱う
    const idParam = req.query.id;
    if (!idParam) {
        return res.status(400).send('講義IDが指定されていません。');
    }
    const lectureId = Number(idParam);
    if (!Number.isInteger(lectureId) || lectureId <= 0) {
        return res.status(400).send('不正な講義IDです。');
    }

    // パラメータ化クエリで lecture_id を検索
    connection.query('SELECT * FROM Mock_Lecture WHERE lecture_id = ?', [lectureId], (err, results) => {
        if (err) {
            console.error('DB取得エラー', err);
            return res.status(500).send('サーバーエラー');
        }
        if (!results || results.length === 0) {
            return res.status(404).send('該当する講義が見つかりません。');
        }

        const lecture = results[0];

        // Session テーブルと Application テーブルを結合して実施回情報を取得
        connection.query(
            `SELECT 
                s.session_id, 
                s.start_datetime, 
                s.end_datetime, 
                s.location, 
                s.max_capacity, 
                COUNT(a.application_id) AS current_applications
             FROM Session s
             LEFT JOIN Application a ON s.session_id = a.session_id
             WHERE s.lecture_id = ?
             GROUP BY s.session_id`,
            [lectureId],
            (err, sessionResults) => {
                if (err) {
                    console.error('DB取得エラー', err);
                    return res.status(500).send('サーバーエラー');
                }

                fs.readFile(path.join(BASE_DIR, 'lecture-detail.html'), 'utf8', (err, htmlContent) => {
                    if (err) {
                        console.error('lecture-detail読み込みエラー', err);
                        return res.status(500).send('サーバーエラー: ファイル読み込み失敗');
                    }

                    // プレースホルダ置換（簡易）
                    let modifiedHtml = htmlContent.replace('{{LECTURE_NAME}}', lecture.lecture_name || '');
                    // outline_pdf_path は DB のパスをそのまま使う（静的配信される前提）
                    const pdfPath = lecture.outline_pdf_path || '';
                    console.log('PDFパス:', pdfPath);
                    modifiedHtml = modifiedHtml.replaceAll('{{PDF_PATH}}', pdfPath);

                    // 実施回情報を生成
                    const formatDateTime = (datetime) => {
                        if (typeof datetime !== 'string') {
                            console.error('Invalid datetime format:', datetime);
                            return '不明な日時'; // デフォルトの値を返す
                        }

                        // "YYYY-MM-DD HH:MM:SS" の形式から "YYYY年MM月DD日 HH時MM分" に変換
                        const year = datetime.slice(0, 4);
                        const month = datetime.slice(5, 7);
                        const day = datetime.slice(8, 10);
                        const hour = datetime.slice(11, 13);
                        const minute = datetime.slice(14, 16);
                        return `${year}年${month}月${day}日 ${hour}時${minute}分`;
                    };

                    const sessionRows = sessionResults.map(session => {
                        return `
                            <tr>
                                <td>${formatDateTime(session.start_datetime)}</td>
                                <td>${formatDateTime(session.end_datetime)}</td>
                                <td>${session.location}</td>
                                <td>${session.max_capacity}</td>
                                <td>${session.current_applications}</td>
                            </tr>
                        `;
                    }).join('\n');

                    modifiedHtml = modifiedHtml.replace('{{SESSION_ROWS}}', sessionRows);

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(modifiedHtml);
                });
            }
        );
    });
});

// multer設定
const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: 2 * 1024 * 1024 }, // 最大2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('PDFファイルのみアップロード可能です。'));
        }
        cb(null, true);
    }
});


// 模擬授業登録API
app.post('/lecture/create', upload.single('outline_pdf'), async (req, res) => {
    const {
        lecture_name,
        staff_names,
        location,
        max_capacity,
        dates,
        sessions
    } = req.body;

    // バリデーション
    if (!lecture_name || lecture_name.length > 60) {
        return res.status(400).send('授業名は必須で、最大60文字です。');
    }
    if (!req.file) {
        return res.status(400).send('授業概要PDFファイルは必須です。');
    }
    if (!Array.isArray(staff_names) || staff_names.length < 1 || staff_names.length > 2) {
        return res.status(400).send('担当教職員は1〜2名を登録してください。');
    }
    if (!location || location.length > 100) {
        return res.status(400).send('開講場所は必須で、最大100文字です。');
    }
    if (!max_capacity || max_capacity < 1 || max_capacity > 40) {
        return res.status(400).send('最大受入可能人数は1〜40名の範囲で設定してください。');
    }
    if (!Array.isArray(dates) || dates.length < 1 || dates.length > 2) {
        return res.status(400).send('開講日は1日または2日を指定してください。');
    }
    if (!Array.isArray(sessions) || sessions.length > 6) {
        return res.status(400).send('1日あたり最大3件、合計最大6件の実施回を登録してください。');
    }

    // 実施時間の重複チェック
    try {
        const [existingLectures] = await connection.promise().query(
            `SELECT s.start_datetime, s.end_datetime 
             FROM Mock_Lecture ml
             JOIN Session s ON ml.lecture_id = s.lecture_id
             WHERE ml.lecture_name = ?`,
            [lecture_name]
        );

        for (const session of sessions) {
            const { date, start_time, end_time } = session;
            const newStart = new Date(`${date}T${start_time}`);
            const newEnd = new Date(`${date}T${end_time}`);

            for (const existing of existingLectures) {
                const existingStart = new Date(existing.start_datetime);
                const existingEnd = new Date(existing.end_datetime);

                if (
                    (newStart >= existingStart && newStart < existingEnd) ||
                    (newEnd > existingStart && newEnd <= existingEnd) ||
                    (newStart <= existingStart && newEnd >= existingEnd)
                ) {
                    return res.status(400).send('同じ模擬授業で実施時間が重複しています。');
                }
            }
        }
    } catch (err) {
        console.error('重複チェックエラー:', err);
        return res.status(500).send('サーバーエラー: 重複チェック失敗');
    }

    // PDFファイル名を生成
    const pdfFilename = `${Date.now()}_${req.file.originalname}`; // タイムスタンプ付きファイル名
    const pdfPath = path.join(UPLOAD_DIR, pdfFilename);

    // ファイルを保存
    fs.rename(req.file.path, pdfPath, (err) => {
        if (err) {
            console.error('PDF保存エラー:', err);
            return res.status(500).send('サーバーエラー: PDF保存失敗');
        }

        // トランザクション開始
        connection.beginTransaction(async (err) => {
            if (err) {
                console.error('トランザクション開始エラー:', err);
                return res.status(500).send('サーバーエラー: トランザクション開始失敗');
            }

            try {
                // Mock_Lectureに登録
                const [lectureResult] = await connection.promise().query(
                    'INSERT INTO Mock_Lecture (lecture_name, outline_pdf_path) VALUES (?, ?)',
                    [lecture_name, `pdf/${pdfFilename}`] // タイムスタンプ付きファイル名を保存
                );
                const lectureId = lectureResult.insertId;

                // Lecture_Staffに登録
                for (const staffName of staff_names) {
                    await connection.promise().query(
                        'INSERT INTO Lecture_Staff (lecture_id, staff_name) VALUES (?, ?)',
                        [lectureId, staffName]
                    );
                }

                // Sessionに登録
                for (const session of sessions) {
                    const { date, start_time, end_time } = session;
                    const startDatetime = `${date} ${start_time}`;
                    const endDatetime = `${date} ${end_time}`;
                    await connection.promise().query(
                        'INSERT INTO Session (lecture_id, start_datetime, end_datetime, location, max_capacity) VALUES (?, ?, ?, ?, ?)',
                        [lectureId, startDatetime, endDatetime, location, max_capacity]
                    );
                }

                // コミット
                connection.commit((err) => {
                    if (err) {
                        throw err;
                    }
                    res.status(201).send('模擬授業が登録されました。');
                });
            } catch (err) {
                console.error('トランザクションエラー:', err);
                connection.rollback(() => {
                    res.status(500).send('サーバーエラー: 登録失敗');
                });
            }
        });
    });
});


// アカウント登録API
app.post('/register', async (req, res) => {
    const {
        email,
        student_first_name,
        student_last_name,
        parent_first_name,
        parent_last_name,
        junior_high_school,
        student_grade,
        password // 平文のパスワード
    } = req.body;

    // バリデーション
    if (!email || !student_first_name || !student_last_name || !parent_first_name || !parent_last_name ||
        !junior_high_school || !student_grade || !password) {
        return res.status(400).send('すべての項目を入力してください。');
    }
    if (!/^[1-3]$/.test(student_grade)) {
        return res.status(400).send('学年は1〜3の範囲で指定してください。');
    }

    try {
        // パスワードをハッシュ化
        const hashedPassword = await bcrypt.hash(password, 10);

        // データベースに登録
        await connection.promise().query(
            `INSERT INTO User (login_id, password_hash, student_name, parent_name, junior_high_school, student_grade, email)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                hashedPassword, // ハッシュ化されたパスワードを保存
                `${student_last_name} ${student_first_name}`,
                `${parent_last_name} ${parent_first_name}`,
                junior_high_school,
                student_grade,
                email
            ]
        );

        res.status(201).send('アカウントが登録されました。');
    } catch (err) {
        console.error('アカウント登録エラー:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).send('このメールアドレスは既に登録されています。');
        }
        res.status(500).send('サーバーエラー: アカウント登録失敗');
    }
});


// ログインAPI
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('メールアドレスとパスワードを入力してください。');
    }

    try {
        const [rows] = await connection.promise().query(
            'SELECT user_id, password_hash FROM User WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).send('メールアドレスまたはパスワードが正しくありません。');
        }

        const user = rows[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).send('メールアドレスまたはパスワードが正しくありません。');
        }

        // セッションにユーザー情報を保存
        req.session.userId = user.user_id;
        res.status(200).send('ログイン成功');
    } catch (err) {
        console.error('ログインエラー:', err);
        res.status(500).send('サーバーエラー: ログイン失敗');
    }
});


// ログアウトAPI
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('ログアウトエラー:', err);
            return res.status(500).send('サーバーエラー: ログアウト失敗');
        }
        res.status(200).send('ログアウト成功');
    });
});


// マイページAPI
app.get('/mypage', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('ログインが必要です。');
    }

    // ユーザー情報を取得して返す
    connection.query(
        'SELECT email, student_name, parent_name, junior_high_school, student_grade FROM User WHERE user_id = ?',
        [req.session.userId],
        (err, results) => {
            if (err) {
                console.error('マイページ取得エラー:', err);
                return res.status(500).send('サーバーエラー');
            }

            if (results.length === 0) {
                return res.status(404).send('ユーザーが見つかりません。');
            }

            res.status(200).json(results[0]);
        }
    );
});

// サーバーを起動
app.listen(PORT, '0.0.0.0', () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    console.log(`ブラウザで http://[publicIPv4]:${PORT}/ を開いてください。`);
});
