type Scene = 'pos' | 'inventory' | 'customers' | 'suppliers' | 'reports' | 'drawer';

export function PosInterface({ scene = 'pos' }: { scene?: Scene }) {
  return (
    <div className="zw-pos" data-scene={scene}>
      <div className="zw-pos__bar">
        <span className="zw-pos__brand">ZELVERO</span>
        <span className="zw-pos__chip">USD / LBP</span>
        <span className="zw-pos__chip zw-pos__chip--ok">Drawer open</span>
      </div>
      {scene === 'pos' && <PosScene />}
      {scene === 'inventory' && <InventoryScene />}
      {scene === 'customers' && <CustomersScene />}
      {scene === 'suppliers' && <SuppliersScene />}
      {scene === 'reports' && <ReportsScene />}
      {scene === 'drawer' && <DrawerScene />}
      <p className="zw-pos__caption">See how fast selling feels with ZELVERO.</p>
    </div>
  );
}

function PosScene() {
  return (
    <div className="zw-pos__grid">
      <div className="zw-pos__products">
        {[
          ['Galaxy A15', '$189.00', '12'],
          ['USB-C Cable', '$4.50', '84'],
          ['Screen Glass', '$6.00', '40'],
          ['Power Bank', '$22.00', '9'],
          ['Earphones', '$8.00', '31'],
          ['Case Clear', '$3.50', '50'],
        ].map(([name, price, stock]) => (
          <article key={name} className="zw-tile">
            <div className="zw-tile__img" />
            <strong>{name}</strong>
            <span className="zw-tile__price">{price}</span>
            <small>Stock {stock}</small>
          </article>
        ))}
      </div>
      <aside className="zw-pos__cart">
        <div className="zw-pos__cart-head">
          <strong>Cart 1</strong>
          <span>Walk-in</span>
        </div>
        <div className="zw-line">
          <span>Galaxy A15</span>
          <span className="zw-money">$189.00</span>
        </div>
        <div className="zw-line">
          <span>Case Clear</span>
          <span className="zw-money">$3.50</span>
        </div>
        <div className="zw-line zw-line--debt">
          <span>Previous balance</span>
          <span className="zw-money">$100.00</span>
        </div>
        <div className="zw-pos__tot">
          <div className="zw-line">
            <span>New sale</span>
            <strong className="zw-money">$192.50</strong>
          </div>
          <div className="zw-line">
            <span>To collect</span>
            <strong className="zw-money">$292.50</strong>
          </div>
        </div>
        <div className="zw-pos__pay">
          <span>Full Payment</span>
          <span>Credit Sale</span>
        </div>
      </aside>
    </div>
  );
}

function InventoryScene() {
  return (
    <table className="zw-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>On hand</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Galaxy A15</td>
          <td>12</td>
          <td>OK</td>
        </tr>
        <tr className="zw-table--warn">
          <td>Power Bank</td>
          <td>9</td>
          <td>Low stock</td>
        </tr>
        <tr>
          <td>USB-C Cable</td>
          <td>84</td>
          <td>OK</td>
        </tr>
      </tbody>
    </table>
  );
}

function CustomersScene() {
  return (
    <div className="zw-stack">
      <div className="zw-line">
        <span>Karim</span>
        <span className="zw-neg zw-money">$100.00</span>
      </div>
      <div className="zw-line">
        <span>Nour</span>
        <span className="zw-money">$0.00</span>
      </div>
      <div className="zw-line">
        <span>Rami</span>
        <span className="zw-neg zw-money">$42.00</span>
      </div>
    </div>
  );
}

function SuppliersScene() {
  return (
    <div className="zw-stack">
      <div className="zw-line">
        <span>Alpha Distributors</span>
        <span className="zw-money">$1,240</span>
      </div>
      <div className="zw-line">
        <span>Purchase #1042</span>
        <span>20 units received</span>
      </div>
      <div className="zw-line">
        <span>Open balance</span>
        <span className="zw-money">$1,240</span>
      </div>
    </div>
  );
}

function ReportsScene() {
  return (
    <div className="zw-report">
      {[
        ['Sales', 'Live'],
        ['Profit', 'Live'],
        ['Expenses', 'Live'],
        ['Debt', 'Live'],
        ['Stock', 'Live'],
        ['Drawer', 'Live'],
      ].map(([label, value], i) => (
        <div key={label} className="zw-stat">
          <span>{label}</span>
          <strong>{value}</strong>
          <i style={{ height: `${36 + i * 9}%` }} />
        </div>
      ))}
    </div>
  );
}

function DrawerScene() {
  return (
    <div className="zw-stack">
      <div className="zw-line">
        <span>USD in drawer</span>
        <span className="zw-money">$420.00</span>
      </div>
      <div className="zw-line">
        <span>LBP in drawer</span>
        <span className="zw-money">12,400,000 LBP</span>
      </div>
      <div className="zw-line">
        <span>Session</span>
        <span>Open</span>
      </div>
    </div>
  );
}
