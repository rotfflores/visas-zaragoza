CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    correo TEXT,
    servicio TEXT NOT NULL,
    fecha TEXT NOT NULL,
    horario TEXT NOT NULL,
    mensaje TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'contactado', 'cerrado')),
    consentimiento_en TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_created_at
ON appointments(creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_status_created_at
ON appointments(estado, creado_en DESC);

PRAGMA optimize;
