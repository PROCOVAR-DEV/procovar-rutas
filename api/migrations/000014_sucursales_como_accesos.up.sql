-- Las sucursales se identifican como en Accesos: por su CÓDIGO (el mismo que usa PEDIDO) y
-- enlazadas a su organización de Accesos. Hasta ahora solo tres tenían el enlace, y
-- «Granma» (GR) de PEDIDO no casaba con «Bayamo» de aquí: sus 18 vendedores salían «sin
-- sucursal» y sus pedidos se descartaban. Los ids son los de la tabla `organization` de Accesos
-- (06/11/2026); donde no existe la fila no hace nada.
UPDATE sucursal s
   SET codigo = v.codigo,
       auth_org_id = coalesce(s.auth_org_id, v.org)
  FROM (VALUES
    ('bayamo',        'GR',  'cmsot58n8000v4vmhsfvn9eto'),
    ('camaguey',      'CAM', 'cmsot58n3000u4vmhv2eoz8yh'),
    ('guantanamo',    'GTO', 'cmsot58nb000w4vmh1vqbcnly'),
    ('habana',        'HAB', 'cmsot58nf000x4vmhp9rutlju'),
    ('holguin',       'HOL', 'cmsot58nk000y4vmhfgq4lbwa'),
    ('lastunas',      'TUN', 'cmsot58od00114vmhwb9yfbrm'),
    ('moa',           'MOA', 'eafc66b49ed2431f80b0e4eb83e77a4e'),
    ('palma',         'PLS', '85f643a57724444a986f14638c335fd7'),
    ('santispiritus', 'SS',  'cmsot58ns000z4vmhw0624hwv'),
    ('santiago',      'STG', 'cmsot58nz00104vmh0i4mxxsi')
  ) AS v(clave, codigo, org)
 WHERE s.clave = v.clave;
