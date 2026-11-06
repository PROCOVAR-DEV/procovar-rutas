-- La jornada pasa a ser de lunes a sábado (06/11/2026). Nadie lee todavía esta columna
-- (el calendario usa el valor del código), pero que no diga otra cosa.
ALTER TABLE sucursal_config ALTER COLUMN dias_laborables SET DEFAULT '{1,2,3,4,5,6}';
UPDATE sucursal_config SET dias_laborables = '{1,2,3,4,5,6}' WHERE dias_laborables = '{1,2,3,4,5}';
