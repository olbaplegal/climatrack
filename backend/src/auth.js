const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'climatrack_token';
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function emitirSessao(res, usuario) {
  const token = jwt.sign({ id: usuario.id, nome: usuario.nome, email: usuario.email }, config.jwtSecret, {
    expiresIn: '7d',
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SETE_DIAS_MS,
  });
}

function encerrarSessao(res) {
  res.clearCookie(COOKIE);
}

function exigirLogin(req, res, next) {
  try {
    req.usuario = jwt.verify(req.cookies[COOKIE], config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ erro: 'Não autenticado' });
  }
}

module.exports = { emitirSessao, encerrarSessao, exigirLogin };
