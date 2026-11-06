ALTER TABLE sucursal_config ALTER COLUMN dias_laborables SET DEFAULT '{1,2,3,4,5}';
UPDATE sucursal_config SET dias_laborables = '{1,2,3,4,5}' WHERE dias_laborables = '{1,2,3,4,5,6}';
