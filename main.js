(() => {
  // ─────── System Config ─────────
  const CONF = {
    adminTag: '000', adminPass: 'admin220700',
    jobs: { chef:5, dev:10, farmer:7 },
    bizs: { farm:50, market:100, factory:200 },
    houses: { hut:500, villa:2000 },
    baseItems: { box:20, pie:5, dice:15, pager:100 },
    MARKET_INTERVAL: 60_000,
    TAX: 0.03, SUBSIDY:0.01,
    DICE: { MIN_BET:5, MAX_ROLL:6, PAY: {6:5, 4:2,5:2} },
    CRIME: { SUCCESS:0.4, FINE_MAX:100, STEAL_MAX:200, JAIL:600_000 }
  };

  // ─────── Database Setup ─────────
  const db = new Dexie('ZXVWP_OS');
  db.version(2).stores({
    users: 'tag,password,balance,job,biz,house,inv,lastPay,jailUntil',
    bank: 'singleton,amount',
    market: 'id,price'
  });

  // ─────── State & UI Helpers ─────────
  let current = null, cli, input;

  const println = (txt, cls='sys') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = txt;
    cli.appendChild(d);
    cli.scrollTop = cli.scrollHeight;
  };

  // ─────── Boot Sequence ─────────
  window.addEventListener('load', async () => {
    cli = document.getElementById('cli');
    input = document.getElementById('input');

    await DB.init();
    Timers.start();

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        Dispatcher.handle(input.value.trim());
        input.value = '';
      }
    });

    println('🚀 Welcome to ZXVWP OS "help" to start.');
  });

  // ───────── DB Manager ─────────
  const DB = {
    init: async () => {
      if (!await db.bank.get(1)) await db.bank.put({ singleton:1, amount:10000 });
      for (let [id, price] of Object.entries(CONF.baseItems))
        if (!await db.market.get(id)) await db.market.put({ id, price });
    },
    bank: async amt => {
      const b = await db.bank.get(1);
      b.amount = amt ?? b.amount;
      await db.bank.put(b);
      return b.amount;
    },
    adjustBank: async delta => {
      const b = await db.bank.get(1);
      b.amount += delta;
      await db.bank.put(b);
    }
  };

  // ───────── Timers & Daemons ─────────
  const Timers = {
    start: () => {
      setInterval(Subsystems.market.update, CONF.MARKET_INTERVAL);
      setInterval(async () => {
        await Subsystems.economy.taxSubsidy();
        await Subsystems.economy.processIncome();
      }, CONF.MARKET_INTERVAL);
    }
  };

  // ───────── Subsystems ─────────
  const Subsystems = {
    market: {
      update: async () => {
        const items = await db.market.toArray();
        for (let i of items) {
          const pct = Math.random()*0.09 + 0.01;
          i.price = Math.max(1, Math.round(i.price * (Math.random()<.5?1-pct:1+pct)*100)/100);
          await db.market.put(i);
        }
        println('📈 Market updated.');
      },
      list: async () => {
        const vals = await db.market.toArray();
        println('Market: ' + vals.map(i=>`${i.id}: $${i.price}`).join(' | '));
      },
      get: async id => await db.market.get(id)
    },

    economy: {
      taxSubsidy: async () => {
        const bank = await db.bank.get(1);
        for (let u of await db.users.toArray()) {
          const tax = Math.round(u.balance * CONF.TAX * 100)/100;
          u.balance -= tax; bank.amount += tax;
          const sub = Math.round(u.balance * CONF.SUBSIDY * 100)/100;
          if (bank.amount >= sub) { u.balance += sub; bank.amount -= sub; }
          await db.users.put(u);
        }
        await db.bank.put(bank);
      },
      processIncome: async () => {
        if (!current) return;
        const now = Date.now();
        const hrs = Math.floor((now - (current.lastPay||now))/3600000);
        if (hrs < 1) return;
        const inc = (current.job ? CONF.jobs[current.job]*hrs : 0) +
                    (current.biz ? CONF.bizs[current.biz]*hrs : 0);
        if (inc > 0) {
          current.balance += inc;
          current.lastPay = now;
          await db.users.put(current);
          await DB.adjustBank(-inc);
          println(`📥 Earned $${inc} (job+biz).`);
        }
      }
    },

    diceGame: async bet => {
      if (bet < CONF.DICE.MIN_BET) return println(`❌ Minimum $${CONF.DICE.MIN_BET}`, 'err');
      if (current.balance < bet) return println('❌ Low balance.', 'err');
      current.balance -= bet;
      const roll = Math.floor(Math.random()*CONF.DICE.MAX_ROLL)+1;
      const payMul = CONF.DICE.PAY[roll] || 0;
      const win = bet * payMul;
      current.balance += win;
      await DB.adjustBank(-win);
      await db.users.put(current);
      println(`🎲 Rolled ${roll}. ${win ? `Won $${win}!` : 'You lose.'}`);
    },

    crime: async () => {
      const ok = Math.random() < CONF.CRIME.SUCCESS;
      if (ok) {
        const bank = await db.bank.get(1);
        const amt = Math.min(bank.amount, Math.floor(Math.random()*CONF.CRIME.STEAL_MAX));
        current.balance += amt;
        await DB.adjustBank(-amt);
        println(`✅ Crime success! +$${amt}`);
      } else {
        const fine = Math.floor(Math.random()*CONF.CRIME.FINE_MAX);
        current.balance -= fine;
        await DB.adjustBank(fine);
        current.jailUntil = Date.now() + CONF.CRIME.JAIL;
        println(`❌ Crime failed! Fined $${fine}, jailed 10min.`, 'err');
      }
      await db.users.put(current);
    }
  };

  // ───────── Dispatcher / Shell ─────────
  const Dispatcher = {
    handle: async line => {
      println(`> ${line}`, 'cmd');
      const [cmd, ...args] = line.split(/\s+/);
      if (cmd !== 'login' && cmd !== 'signup' && !current) {
        return println('❌ Please login/signup.', 'err');
      }
      if (current?.jailUntil > Date.now() && cmd !== 'help') {
        return println('🚨 You are jailed.', 'err');
      }
      const f = this.commands[cmd];
      return f ? f(...args) : println('❌ Unknown cmd. Type help.', 'err');
    },

    commands: {
      help: () => println(`USER: signup <pass>, login <tag> <pass>, logout
ECONOMY: market, buy <item> <qty>, sell <item> <qty>
GAME: dice <bet>, crime
WORK: joblist, applyjob <job>, quitjob
BIZ: bizlist, buybiz <biz>, sellbiz
HOME: buyhouse <type>, sellhouse
INFO: inventory, profile, life
SAVE: save, load
ADMIN: bank view/set <amt>`, 'sys'),

      signup: async pw => {
        if (!pw || pw.length < 6) return println('❌ PW ≥6 chars.', 'err');
        const tags = (await db.users.toArray()).map(u=>+u.tag);
        const tag = String((Math.max(0, ...tags) + 1)).padStart(3, '0');
        await db.users.put({ tag, password: pw, balance:0, job:null, biz:null, house:null, inv:{}, lastPay:Date.now(), jailUntil:null });
        println(`✅ Created ${tag}. Use login.`);
      },

      login: async (tag, pw) => {
        if (tag === CONF.adminTag && pw === CONF.adminPass) {
          current = { tag, admin:true }; println('🛡️ Admin mode.');
          return;
        }
        const u = await db.users.get({ tag, password: pw });
        if (!u) println('❌ Failed login.', 'err');
        else { current = u; println(`✅ Welcome ${tag}`); }
      },

      logout: () => { current = null; println('📤 Logged out.'); },

      market: async () => Subsystems.market.list(),

      buy: async (id, qtyStr) => {
        const qty = Math.floor(+qtyStr);
        if (!qty) return println('❌ Invalid qty.', 'err');
        const m = await Subsystems.market.get(id);
        if (!m) return println('❌ No such item.', 'err');
        const cost = Math.round(m.price*qty*100)/100;
        if (current.balance < cost) return println('❌ Low funds.', 'err');
        current.balance -= cost;
        current.inv[id] = (current.inv[id]||0)+qty;
        await DB.adjustBank(cost);
        await db.users.put(current);
        println(`✅ Bought ${qty}×${id}=$${cost}`);
      },

      sell: async (id, qtyStr) => {
        const qty = Math.floor(+qtyStr);
        if (!qty || (current.inv[id]||0)<qty) return println('❌ Invalid or insufficient.', 'err');
        const m = await Subsystems.market.get(id);
        const refund = Math.round(m.price*qty*0.2*100)/100;
        current.inv[id] -= qty;
        current.balance += refund;
        await DB.adjustBank(-refund);
        await db.users.put(current);
        println(`💰 Sold ${qty}×${id}=$${refund}`);
      },

      dice: async betStr => {
        const bet = Math.round(+betStr);
        await Subsystems.diceGame(bet);
      },

      crime: async () => { await Subsystems.crime(); },

      joblist: () => println(`Jobs: ` + Object.entries(CONF.jobs).map(j=>`${j[0]}:$${j[1]}/h`).join(' | ')),
      applyjob: async j => {
        if (!CONF.jobs[j]) return println('❌ No job.', 'err');
        current.job = j; await db.users.put(current); println(`✅ Job=${j}`);
      },
      quitjob: async () => { current.job = null; await db.users.put(current); println('✅ Quit job'); },

      bizlist: () => println(`Bizs: ` + Object.entries(CONF.bizs).map(b=>`${b[0]}:$${b[1]}/h`).join(' | ')),
      buybiz: async b => {
        if (!CONF.bizs[b]) return println('❌ No biz.', 'err');
        current.biz = b; await db.users.put(current); println(`✅ Biz=${b}`);
      },
      sellbiz: async () => {
        if (!current.biz) return println('❌ No biz.', 'err');
        const inc = CONF.bizs[current.biz]*0.5;
        current.balance += inc;
        await DB.adjustBank(-inc);
        await db.users.put(current);
        println(`💰 Sold biz+$${inc}`);
      },

      buyhouse: async h => {
        if (!CONF.houses[h]) return println('❌ No house.', 'err');
        current.house = h; await db.users.put(current); println(`🏠 House=${h}`);
      },
      sellhouse: async () => {
        if (!current.house) return println('❌ No house.', 'err');
        const refund = CONF.houses[current.house]*0.2;
        current.balance += refund;
        await DB.adjustBank(-refund);
        await db.users.put(current);
        println(`💵 House sold +$${refund}`);
      },

      inventory: () => println('Inv: ' + JSON.stringify(current.inv)),
      profile: () => println(JSON.stringify({
        tag: current.tag, balance: current.balance.toFixed(2),
        job: current.job, biz: current.biz, house: current.house
      }, null,2)),
      life: () => println(`Life: ${(current.life||0).toFixed(2)}h`),

      save: async () => {
        const dump = [
          ...(await db.bank.toArray()),
          ...(await db.market.toArray()),
          ...(await db.users.toArray())
        ];
        const blob = new Blob([JSON.stringify(dump)], { type:'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'zxvwp_os.zxvwp';
        a.click();
        println('✅ Backup saved.');
      },

      load: async () => {
        const inpFile = document.createElement('input');
        inpFile.type = 'file';
        inpFile.accept = '.zxvwp,.json';
        inpFile.onchange = async e => {
          try {
            const data = JSON.parse(await e.target.files[0].text());
            if (!Array.isArray(data)) throw new Error();
            await db.delete();
            await DB.init();
            for (let o of data) {
              if (o.singleton) await db.bank.put(o);
              else if (o.id) await db.market.put(o);
              else await db.users.put(o);
            }
            println('✅ Backup loaded. Reloading...');
            setTimeout(() => location.reload(), 500);
          } catch {
            println('❌ Invalid backup.', 'err');
          }
        };
        inpFile.click();
      },

      bank: async (op, amtStr) => {
        if (!(current && current.admin)) return println('❌ Admin only.', 'err');
        if (op === 'view') {
          const b = await db.bank.get(1);
          println(`🏦 Bank: $${b.amount.toFixed(2)}`);
        } else if (op === 'set') {
          const v = +amtStr;
          if (isNaN(v)) return println('❌ Invalid value.', 'err');
          await DB.bank(v);
          println(`✅ Bank set → $${v}`);
        } else println('❌ Usage: bank view | set <amt>');
      }
    }
  };
})();
