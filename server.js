const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir os arquivos visuais da interface (index.html) na raiz do servidor
app.use(express.static(__dirname));

// Configuração da Conexão com o Banco PostgreSQL
// 💡 ATENÇÃO: Se o PostgreSQL der erro de senha no terminal, altere a linha 'password' abaixo para a sua senha real do Postgres!
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'biblioteca_online',
    password: process.env.DB_PASSWORD || '123456', // <-- Altere aqui para a sua senha do PostgreSQL se for diferente
    port: process.env.DB_PORT || 5432,
});

// Inicialização e Criação Automática das Tabelas se não existirem
const initDb = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ Conectado ao banco de dados PostgreSQL (biblioteca_online) com sucesso!');

        // 1. Tabela de Usuários (Leitores)
        await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        data_nascimento DATE NOT NULL,
        idade SMALLINT NOT NULL DEFAULT 0,
        data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

        // 2. Tabela de Livros (com CDD e Palavras-chave)
        await client.query(`
      CREATE TABLE IF NOT EXISTS livros (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(200) NOT NULL,
        autor VARCHAR(150) NOT NULL,
        isbn VARCHAR(20) UNIQUE,
        cdd VARCHAR(20),
        categoria VARCHAR(50),
        palavras_chave VARCHAR(255),
        ano_publicacao INT,
        quantidade INT DEFAULT 1,
        disponiveis INT DEFAULT 1,
        data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

        // 3. Tabela de Empréstimos
        await client.query(`
      CREATE TABLE IF NOT EXISTS emprestimos (
        id SERIAL PRIMARY KEY,
        usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        livro_id INT NOT NULL REFERENCES livros(id) ON DELETE CASCADE,
        data_emprestimo TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_devolucao_prevista DATE NOT NULL,
        data_devolucao_real TIMESTAMP,
        status VARCHAR(20) DEFAULT 'EMPRESTADO'
      );
    `);

        client.release();
        console.log('✅ Estrutura do banco de dados (tabelas) inicializada!');
    } catch (err) {
        console.error('❌ Erro ao conectar/inicializar banco de dados:', err.message);
        if (err.message.includes('password authentication failed')) {
            console.error('👉 ATENÇÃO: A SENHA DO POSTGRESQL ESTÁ INCORRETA no server.js!');
            console.error('   Abra o arquivo server.js no IntelliJ e altere a linha 25: password: \'SUA_SENHA_DO_POSTGRES\'');
        }
    }
};

initDb();

// ============================================================================
// ROTAS E ENDPOINTS DA API REST
// ============================================================================

// 0. Autenticação (Login da Tela Inicial) - Validação com e-mail e senha específicos (123456)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Informe o e-mail e a senha.' });
    }

    if (email === 'andretortato2812@gmail.com' && password === '123456') {
        return res.json({
            message: 'Login realizado com sucesso!',
            user: { email, role: 'administrador' },
            token: 'jwt-token-prof-andre-tortato'
        });
    }

    return res.status(401).json({ error: 'E-mail ou senha incorretos!' });
});

// 1. DASHBOARD - Obter Estatísticas Gerais
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const totalLivrosRes = await pool.query('SELECT COALESCE(SUM(quantidade), 0) as total, COALESCE(SUM(disponiveis), 0) as disponiveis FROM livros');
        const totalUsuariosRes = await pool.query('SELECT COUNT(*) as count FROM usuarios');
        const emprestimosAtivosRes = await pool.query("SELECT COUNT(*) as count FROM emprestimos WHERE status = 'EMPRESTADO'");

        res.json({
            total_exemplares: parseInt(totalLivrosRes.rows[0].total),
            disponiveis: parseInt(totalLivrosRes.rows[0].disponiveis),
            leitores_cadastrados: parseInt(totalUsuariosRes.rows[0].count),
            emprestimos_ativos: parseInt(emprestimosAtivosRes.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. LIVROS - Listar todos com Busca Inteligente
app.get('/api/livros', async (req, res) => {
    const { busca } = req.query;
    try {
        let query = 'SELECT * FROM livros';
        let values = [];

        if (busca) {
            query += ` WHERE 
        titulo ILIKE $1 OR 
        autor ILIKE $1 OR 
        categoria ILIKE $1 OR 
        cdd ILIKE $1 OR 
        palavras_chave ILIKE $1`;
            values.push(`%${busca}%`);
        }

        query += ' ORDER BY id DESC';

        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LIVROS - Cadastrar Livro
app.post('/api/livros', async (req, res) => {
    const { titulo, autor, isbn, cdd, categoria, palavras_chave, ano_publicacao, quantidade } = req.body;

    if (!titulo || !autor) {
        return res.status(400).json({ error: 'Título e Autor são obrigatórios.' });
    }

    const qty = parseInt(quantidade) || 1;

    try {
        const result = await pool.query(
            `INSERT INTO livros (titulo, autor, isbn, cdd, categoria, palavras_chave, ano_publicacao, quantidade, disponiveis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
            [titulo, autor, isbn || null, cdd || null, categoria || 'Geral', palavras_chave || '', ano_publicacao || null, qty]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LIVROS - Excluir Livro
app.delete('/api/livros/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM livros WHERE id = $1', [id]);
        res.json({ message: 'Livro excluído com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. USUÁRIOS (Leitores) - Listar Leitores
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM usuarios ORDER BY nome ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// USUÁRIOS - Cadastrar Leitor
app.post('/api/usuarios', async (req, res) => {
    const { nome, email, data_nascimento, idade } = req.body;

    if (!nome || !email || !data_nascimento) {
        return res.status(400).json({ error: 'Nome, E-mail e Data de Nascimento são obrigatórios.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO usuarios (nome, email, data_nascimento, idade)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
            [nome, email, data_nascimento, idade || 0]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'O e-mail informado já está cadastrado.' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 4. EMPRÉSTIMOS - Listar Todos os Empréstimos
app.get('/api/emprestimos', async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT 
        e.id,
        e.usuario_id,
        u.nome AS usuario_nome,
        u.email AS usuario_email,
        e.livro_id,
        l.titulo AS livro_titulo,
        l.cdd AS livro_cdd,
        TO_CHAR(e.data_emprestimo, 'YYYY-MM-DD') AS data_emprestimo,
        TO_CHAR(e.data_devolucao_prevista, 'YYYY-MM-DD') AS data_devolucao_prevista,
        TO_CHAR(e.data_devolucao_real, 'YYYY-MM-DD') AS data_devolucao_real,
        e.status
      FROM emprestimos e
      JOIN usuarios u ON e.usuario_id = u.id
      JOIN livros l ON e.livro_id = l.id
      ORDER BY e.id DESC
    `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// EMPRÉSTIMOS - Realizar Novo Empréstimo
app.post('/api/emprestimos', async (req, res) => {
    const { usuario_id, livro_id, dias } = req.body;

    if (!usuario_id || !livro_id) {
        return res.status(400).json({ error: 'Leitor e Livro são obrigatórios.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const bookCheck = await client.query('SELECT disponiveis FROM livros WHERE id = $1 FOR UPDATE', [livro_id]);

        if (bookCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Livro não encontrado.' });
        }

        if (bookCheck.rows[0].disponiveis <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Livro indisponível para empréstimo no momento.' });
        }

        const prazoDias = parseInt(dias) || 14;

        const loanResult = await client.query(
            `INSERT INTO emprestimos (usuario_id, livro_id, data_devolucao_prevista)
       VALUES ($1, $2, CURRENT_DATE + ($3 || ' days')::INTERVAL)
       RETURNING *`,
            [usuario_id, livro_id, prazoDias]
        );

        await client.query(
            'UPDATE livros SET disponiveis = disponiveis - 1 WHERE id = $1',
            [livro_id]
        );

        await client.query('COMMIT');
        res.status(201).json(loanResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// EMPRÉSTIMOS - Registrar Devolução de Livro
app.put('/api/emprestimos/:id/devolver', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const loanRes = await client.query('SELECT * FROM emprestimos WHERE id = $1 AND status = \'EMPRESTADO\' FOR UPDATE', [id]);

        if (loanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Empréstimo não encontrado ou já devolvido.' });
        }

        const loan = loanRes.rows[0];

        await client.query(
            `UPDATE emprestimos 
       SET status = 'DEVOLVIDO', data_devolucao_real = CURRENT_TIMESTAMP 
       WHERE id = $1`,
            [id]
        );

        await client.query(
            'UPDATE livros SET disponiveis = disponiveis + 1 WHERE id = $1',
            [loan.livro_id]
        );

        await client.query('COMMIT');
        res.json({ message: 'Devolução registrada com sucesso e estoque atualizado!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Inicializar Servidor Backend
app.listen(PORT, () => {
    console.log(`🚀 Servidor da Biblioteca rodando em http://localhost:${PORT}`);
    console.log(`📚 API desenvolvida pelo Prof. André Rafael Tortato`);
});