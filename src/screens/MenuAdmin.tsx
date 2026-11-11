import { useState } from 'react';
import { mutate, uid, useDb } from '../data/store';
import type { Category, ModifierGroup, ModifierKind, Product } from '../types';
import { DAY_NAMES, daysLabel, money } from '../lib/format';
import { ConfirmButton, Modal, Tabs } from '../components/ui';

const KIND_LABEL: Record<ModifierKind, string> = {
  single: 'Elegir una opción',
  multi: 'Elegir varias',
  qty: 'Cantidades (ej. cremas)',
};

export function MenuAdmin() {
  const [tab, setTab] = useState<'productos' | 'personalizaciones' | 'categorias'>('productos');
  return (
    <div className="page wide">
      <div className="section-head"><h2>Carta</h2></div>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'productos', label: 'Platos y bebidas' },
        { value: 'personalizaciones', label: 'Personalizaciones' },
        { value: 'categorias', label: 'Categorías' },
      ]} />
      {tab === 'productos' && <Products />}
      {tab === 'personalizaciones' && <Groups />}
      {tab === 'categorias' && <Categories />}
    </div>
  );
}

function Products() {
  const db = useDb();
  const [edit, setEdit] = useState<Product | null>(null);
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  return (
    <>
      <button className="btn primary" onClick={() => setEdit({ id: '', name: '', categoryId: cats[0]?.id ?? '', price: 0, localPrices: {}, groupIds: [], active: true })}>+ Nuevo producto</button>
      {cats.map((c) => (
        <div key={c.id} className="card">
          <h3>{c.name}</h3>
          <ul className="list">
            {db.products.filter((p) => p.categoryId === c.id).map((p) => (
              <li key={p.id} className={p.active ? '' : 'inactive'}>
                <div className="grow">
                  <b>{p.name}</b> · {money(p.price)}
                  {Object.keys(p.localPrices).length > 0 && <span className="pill">precio por local</span>}
                  {!p.active && <span className="pill">oculto</span>}
                  {p.days?.length ? <span className="pill">{daysLabel(p.days)}</span> : null}
                  <div className="muted small">{p.groupIds.map((g) => db.groups.find((x) => x.id === g)?.name).filter(Boolean).join(' · ') || 'Sin personalización'}</div>
                </div>
                <button className="btn small" onClick={() => setEdit(p)}>Editar</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {edit && <ProductForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ProductForm({ initial, onClose }: { initial: Product; onClose: () => void }) {
  const db = useDb();
  const [p, setP] = useState<Product>(initial);
  const save = () => {
    if (!p.name.trim()) return;
    mutate((d) => {
      const item = { ...p, name: p.name.trim(), id: p.id || uid('p') };
      const idx = d.products.findIndex((x) => x.id === item.id);
      if (idx >= 0) d.products[idx] = item; else d.products.push(item);
    });
    onClose();
  };
  const toggleGroup = (id: string) => setP({ ...p, groupIds: p.groupIds.includes(id) ? p.groupIds.filter((g) => g !== id) : [...p.groupIds, id] });
  const move = (id: string, dir: -1 | 1) => {
    const arr = [...p.groupIds];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setP({ ...p, groupIds: arr });
  };
  return (
    <Modal title={p.id ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}
      footer={<div className="row gap">
        {p.id && <ConfirmButton label="Eliminar" title="Eliminar producto" message={`Se quitará “${p.name}” de la carta. Los reportes de ventas anteriores se conservan.`} confirmLabel="Eliminar" onConfirm={() => { mutate((d) => { d.products = d.products.filter((x) => x.id !== p.id); }); onClose(); }} />}
        <button className="btn primary grow" onClick={save}>Guardar</button>
      </div>}>
      <label className="field"><span>Nombre</span><input id="p-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
      <label className="field"><span>Qué incluye (lo ve el cliente en la carta)</span><textarea id="p-desc" rows={2} value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} placeholder="Ej. Hotdog + chorizo + huevo frito" /></label>
      <label className="field"><span>Etiqueta destacada (opcional)</span><input id="p-badge" value={p.badge ?? ''} onChange={(e) => setP({ ...p, badge: e.target.value })} placeholder="Ej. La más vendida" /></label>
      <label className="field"><span>Categoría</span>
        <select value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })}>
          {db.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Precio (S/)</span><input type="number" inputMode="decimal" value={p.price || ''} onChange={(e) => setP({ ...p, price: Number(e.target.value) })} /></label>
      {db.locales.map((l) => (
        <label key={l.id} className="field"><span>Precio en {l.name} (vacío = el mismo)</span>
          <input type="number" inputMode="decimal" value={p.localPrices[l.id] ?? ''} onChange={(e) => {
            const lp = { ...p.localPrices };
            if (e.target.value === '') delete lp[l.id]; else lp[l.id] = Number(e.target.value);
            setP({ ...p, localPrices: lp });
          }} />
        </label>
      ))}
      <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Disponible (visible en la carta)</label>
      <fieldset className="mod-group">
        <legend>Días disponibles <span className="pill">{daysLabel(p.days)}</span></legend>
        <div className="day-picks">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = !!p.days?.includes(d);
            return <button key={d} type="button" className={on ? 'seg active' : 'seg'} aria-pressed={on} onClick={() => setP({ ...p, days: on ? (p.days ?? []).filter((x) => x !== d) : [...(p.days ?? []), d] })}>{DAY_NAMES[d]}</button>;
          })}
        </div>
        <div className="row gap wrap">
          <button type="button" className="link small" onClick={() => setP({ ...p, days: [1, 2, 3, 4, 5] })}>Lunes a viernes</button>
          <button type="button" className="link small" onClick={() => setP({ ...p, days: [] })}>Todos los días</button>
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" checked={(p.packaging ?? db.categories.find((c) => c.id === p.categoryId)?.packaging) !== false} onChange={(e) => setP({ ...p, packaging: e.target.checked })} /> Cuenta para el costo de empaque en delivery</label>
      <fieldset className="mod-group">
        <legend>Personalizaciones de este producto</legend>
        {db.groups.map((g) => (
          <label key={g.id} className="mod-opt">
            <input type="checkbox" checked={p.groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
            <span className="grow">{g.name} <span className="muted small">({KIND_LABEL[g.kind]})</span></span>
          </label>
        ))}
      </fieldset>
      {p.groupIds.length > 1 && (
        <fieldset className="mod-group">
          <legend>Orden en que se muestran</legend>
          {p.groupIds.map((id) => (
            <div key={id} className="mod-opt">
              <span className="grow">{db.groups.find((g) => g.id === id)?.name}</span>
              <button className="icon-btn" aria-label="Subir" onClick={() => move(id, -1)}>↑</button>
              <button className="icon-btn" aria-label="Bajar" onClick={() => move(id, 1)}>↓</button>
            </div>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}

function Groups() {
  const db = useDb();
  const [edit, setEdit] = useState<ModifierGroup | null>(null);
  return (
    <>
      <p className="muted">Crea grupos como “Cremas”, “Arroz”, “Salsa de alitas” y asígnalos a los productos que los usan.</p>
      <button className="btn primary" onClick={() => setEdit({ id: '', name: '', kind: 'single', required: true, max: 1, free: 0, freeTiers: [], options: [] })}>+ Nueva personalización</button>
      <div className="cards">
        {db.groups.map((g) => (
          <div key={g.id} className="card">
            <div className="row between"><b>{g.name}</b><button className="btn small" onClick={() => setEdit(g)}>Editar</button></div>
            <div className="muted small">
              {KIND_LABEL[g.kind]} · {g.required ? 'obligatorio' : 'opcional'}{g.orderLevel ? ' · al final del pedido' : ''}
              {g.kind !== 'single' && g.max > 0 ? ` · máx. ${g.max}` : ''}{g.kind === 'qty' && g.freeTiers?.length ? ` · gratis según precio: ${[...g.freeTiers].sort((a, b) => a.min - b.min).map((t) => `${t.free} desde ${money(t.min)}`).join(', ')}` : g.kind === 'qty' && g.free > 0 ? ` · ${g.free} gratis` : ''}
              {' · '}usado en {db.products.filter((p) => p.groupIds.includes(g.id)).length} productos
            </div>
            <div className="small">{g.options.map((o) => o.name + (o.price ? ` (+${money(o.price)})` : '')).join(' · ')}</div>
          </div>
        ))}
      </div>
      {edit && <GroupForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function GroupForm({ initial, onClose }: { initial: ModifierGroup; onClose: () => void }) {
  const [g, setG] = useState<ModifierGroup>(initial);
  const save = () => {
    if (!g.name.trim() || g.options.filter((o) => o.name.trim()).length === 0) return;
    mutate((d) => {
      const item: ModifierGroup = {
        ...g, id: g.id || uid('g'), name: g.name.trim(),
        max: g.kind === 'single' ? 1 : g.max, free: g.kind === 'qty' ? g.free : 0,
        freeTiers: g.kind === 'qty' ? [...(g.freeTiers ?? [])].sort((a, b) => a.min - b.min) : [],
        options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim() })),
      };
      const idx = d.groups.findIndex((x) => x.id === item.id);
      if (idx >= 0) d.groups[idx] = item; else d.groups.push(item);
    });
    onClose();
  };
  return (
    <Modal title={g.id ? 'Editar personalización' : 'Nueva personalización'} onClose={onClose}
      footer={<div className="row gap">
        {g.id && <ConfirmButton label="Eliminar" title="Eliminar personalización" message={`Se quitará “${g.name}” de todos los productos que la usan.`} confirmLabel="Eliminar" onConfirm={() => { mutate((d) => { d.groups = d.groups.filter((x) => x.id !== g.id); d.products.forEach((p) => { p.groupIds = p.groupIds.filter((x) => x !== g.id); }); }); onClose(); }} />}
        <button className="btn primary grow" onClick={save}>Guardar</button>
      </div>}>
      <label className="field"><span>Nombre (lo que ve el mozo y cocina)</span><input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Ej. Salsa de alitas" /></label>
      <label className="field"><span>Tipo</span>
        <select value={g.kind} onChange={(e) => setG({ ...g, kind: e.target.value as ModifierKind })}>
          {(Object.keys(KIND_LABEL) as ModifierKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={g.required} onChange={(e) => setG({ ...g, required: e.target.checked })} /> Obligatorio (el mozo debe elegir)</label>
      <label className="check"><input type="checkbox" checked={!!g.orderLevel} onChange={(e) => setG({ ...g, orderLevel: e.target.checked })} /> Se elige al final del pedido, para todos los platos (como las cremas)</label>
      {g.kind === 'single' && (
        <label className="field"><span>Opción marcada por defecto</span>
          <select id="g-default" value={g.defaultOptionId ?? ''} onChange={(e) => setG({ ...g, defaultOptionId: e.target.value || undefined })}>
            <option value="">Ninguna (el mozo elige)</option>
            {g.options.filter((o) => o.name.trim()).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      {g.kind !== 'single' && (
        <label className="field"><span>Máximo total (0 = sin límite)</span><input type="number" inputMode="numeric" value={g.max} onChange={(e) => setG({ ...g, max: Number(e.target.value) })} /></label>
      )}
      {g.kind === 'qty' && (
        <fieldset className="mod-group">
          <legend>Unidades gratis</legend>
          <label className="check"><input type="radio" name="free-mode" checked={!g.freeTiers?.length} onChange={() => setG({ ...g, freeTiers: [] })} /> Cantidad fija</label>
          <label className="check"><input type="radio" name="free-mode" checked={!!g.freeTiers?.length} onChange={() => setG({ ...g, freeTiers: [{ min: 0, free: 4 }, { min: 20, free: 6 }, { min: 30, free: 8 }, { min: 40, free: 10 }] })} /> Según el precio del plato</label>
          {!g.freeTiers?.length ? (
            <label className="field"><span>Gratis por plato (las demás se cobran)</span><input id="g-free" type="number" inputMode="numeric" value={g.free} onChange={(e) => setG({ ...g, free: Number(e.target.value) })} /></label>
          ) : (
            <>
              <div className="tier-row muted small"><span>Plato desde (S/)</span><span>Gratis</span><span /></div>
              {g.freeTiers.map((t, i) => (
                <div key={i} className="tier-row">
                  <input type="number" inputMode="decimal" aria-label="Precio desde" value={t.min} onChange={(e) => setG({ ...g, freeTiers: g.freeTiers.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} />
                  <input type="number" inputMode="numeric" aria-label="Cantidad gratis" value={t.free} onChange={(e) => setG({ ...g, freeTiers: g.freeTiers.map((x, j) => (j === i ? { ...x, free: Number(e.target.value) } : x)) })} />
                  <button className="icon-btn" aria-label="Quitar fila" onClick={() => setG({ ...g, freeTiers: g.freeTiers.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              <button className="btn ghost small" onClick={() => setG({ ...g, freeTiers: [...g.freeTiers, { min: 0, free: 0 }] })}>+ Agregar rango</button>
              <p className="muted small">Ejemplo: un plato de S/ 25 usa la fila “desde 20”.</p>
            </>
          )}
        </fieldset>
      )}
      <fieldset className="mod-group">
        <legend>Opciones</legend>
        {g.options.map((o, i) => (
          <div key={o.id} className="pay-line">
            <input value={o.name} placeholder="Nombre" onChange={(e) => setG({ ...g, options: g.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input type="number" inputMode="decimal" value={o.price || ''} placeholder="+S/ 0" onChange={(e) => setG({ ...g, options: g.options.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
            <button className="icon-btn" aria-label="Quitar opción" onClick={() => setG({ ...g, options: g.options.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => setG({ ...g, options: [...g.options, { id: uid('op'), name: '', price: 0 }] })}>+ Agregar opción</button>
      </fieldset>
    </Modal>
  );
}

function Categories() {
  const db = useDb();
  const cats = [...db.categories].sort((a, b) => a.order - b.order);
  const update = (c: Category) => mutate((d) => { const i = d.categories.findIndex((x) => x.id === c.id); if (i >= 0) d.categories[i] = c; });
  return (
    <div className="card">
      <ul className="list">
        {cats.map((c, i) => (
          <li key={c.id}>
            <input className="grow" aria-label="Nombre de la categoría" value={c.name} onChange={(e) => update({ ...c, name: e.target.value })} />
            <label className="check small" title="Si sus platos cuentan para el costo de empaque en delivery"><input type="checkbox" checked={c.packaging !== false} onChange={(e) => update({ ...c, packaging: e.target.checked })} /> Empaque</label>
            <button className="icon-btn" aria-label="Subir" disabled={i === 0} onClick={() => mutate((d) => { const a = d.categories.find((x) => x.id === c.id)!; const b = d.categories.find((x) => x.id === cats[i - 1].id)!; [a.order, b.order] = [b.order, a.order]; })}>↑</button>
            <button className="icon-btn" aria-label="Eliminar categoría" title={db.products.some((p) => p.categoryId === c.id) ? 'Mueve primero sus productos a otra categoría' : 'Eliminar'} disabled={db.products.some((p) => p.categoryId === c.id)} onClick={() => mutate((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); })}>✕</button>
          </li>
        ))}
      </ul>
      <button className="btn ghost small" onClick={() => mutate((d) => { d.categories.push({ id: uid('c'), name: 'Nueva categoría', order: Math.max(0, ...d.categories.map((x) => x.order)) + 1 }); })}>+ Agregar categoría</button>
    </div>
  );
}
