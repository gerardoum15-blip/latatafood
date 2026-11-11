# POS Restaurante

App web instalable (iPhone y Android) para pedidos de salón y delivery en dos locales.

- Usuarios: Administrador, Cocina (por local), Mozo de tienda, Mozo delivery, Driver.
- Platos personalizables (cremas, arroz, ensalada, salsas, etc.).
- Estados del pedido en cocina y delivery, con mensaje de WhatsApp al cliente.
- Reportes por día/semana/mes/año/rango, por ítem y personalización, exportables a Excel.
- Tickets seleccionables para emitir en SUNAT (conexión pendiente).

## Desarrollo

```bash
npm install
npm run dev
```

`npm run build` genera `dist/` para publicar. Los datos se guardan por ahora en el dispositivo (`src/data/store.ts`); el siguiente paso es conectarlo a Supabase para compartirlos entre usuarios.
