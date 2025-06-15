const db = new Dexie("zxvwp");
db.version(1).stores({
  users: "++tag,password,balance,job,business,house,inventory,lastPayTime,life,signedAt",
  bank: "singleton,balance",
  market: "item,price"
});

const $cli = document.getElementById("cli");
const $input = document.getElementById("input");

let current = null;
let adminTag = "000";
let adminPassword = "admin220700";

const defaultItems = {
  "📦": 20,
  "🥧": 5,
  "🎲": 15,
  "📟": 100
};

const jobs = {
  chef: 20,
  coder: 35,
  janitor: 10
};

const businesses = {
  cafe: { price: 500, income: 25 },
  firm: { price: 1000, income: 60 }
};

const houses = {
  flat: 300,
  villa: 1000
};

function println(text, cls) {
  $cli.innerHTML += `\n${text}`;
  $cli.scrollTop = $cli.scrollHeight;
}

function setupMarket() {
  return db.market.clear().then(() => {
    for (let [item, price] of Object.entries(defaultItems)) {
      db.market.put({ item, price });
    }
  });
}

function setupBank() {
  return db.bank.put({ singleton: 1, balance: 100000 });
}

async function setup() {
  const bank = await db.bank.get(1);
  if (!bank) await setupBank();

  const items = await db.market.toArray();
  if (items.length === 0) await setupMarket();
}

function updateMarketPrices() {
  db.market.toCollection().modify(m => {
    let change = 1 + (Math.random() * 0.1) * (Math.random() < 0.5 ? -1 : 1);
    m.price = Math.max(1, Math.round(m.price * change));
  });
}

setInterval(updateMarketPrices, 60000); // 1 min price updates

function getElapsedHours(last) {
  return Math.floor((Date.now() - last) / 3600000);
}

function payPassiveIncome(user) {
  const elapsed = getElapsedHours(user.lastPayTime);
  if (elapsed > 0) {
    const jobPay = jobs[user.job] || 0;
    const bizPay = businesses[user.business]?.income || 0;
    const total = (jobPay + bizPay) * elapsed;
    user.balance += total;
    user.lastPayTime = Date.now();
    db.users.put(user);
    db.bank.get(1).then(bank => {
      bank.balance -= total;
      db.bank.put(bank);
    });
  }
}

function taxAndSubsidy(user) {
  const tax = Math.floor(user.balance * 0.03);
  const subsidy = Math.floor(user.balance * 0.01);
  user.balance += subsidy - tax;
  db.users.put(user);
  db.bank.get(1).then(bank => {
    bank.balance += tax - subsidy;
    db.bank.put(bank);
  });
}

function saveData() {
  Promise.all([
    db.users.toArray(),
    db.bank.toArray(),
    db.market.toArray()
  ]).then(([users, bank, market]) => {
    const blob = new Blob([JSON.stringify([...users, ...bank, ...market])], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "zxvwp.zxvwp";
    a.click();
  });
}

const dispatch = async cmd => {
  const [base, ...args] = cmd.trim().split(" ");
  const arg = args.join(" ");

  if (base === "signup") {
    if (args[0].length < 6) return println("❌ Password too short.");
    const tag = String((await db.users.count()) + 1).padStart(3, "0");
    await db.users.put({
      tag, password: args[0], balance: 100, inventory: {}, lastPayTime: Date.now(), life: 0, signedAt: Date.now()
    });
    println(`✅ Signed up as ${tag}. Use: login ${tag} <pass>`);
  }

  else if (base === "login") {
    const user = await db.users.get(args[0]);
    if (!user || user.password !== args[1]) return println("❌ Invalid login.");
    current = user;
    println(`✅ Welcome ${user.tag}.`);
    payPassiveIncome(current);
    taxAndSubsidy(current);
    if (current.tag === adminTag && current.password === adminPassword) println("👑 Admin access granted.");
  }

  else if (base === "logout") {
    current = null;
    println("✅ Logged out.");
  }

  else if (base === "help") {
    println(`📖 Commands:
signup <pass>, login <tag> <pass>, logout
joblist, applyjob <name>, quitjob
bizlist, buybiz <name>, sellbiz
itemlist, buyitem <emoji> <qty>, sellitem <emoji> <qty>
inventory, profile, stats
buyhouse <type>, sellhouse
crime, travel, charity <amount>
life, save, load
bank view, bank set <amt> (admin only)`);
  }

  else if (!current && base !== "load") {
    println("❌ Please login or use 'load' first.");
  }

  else if (base === "joblist") {
    for (let [j, s] of Object.entries(jobs)) println(`${j} - $${s}/hr`);
  }

  else if (base === "applyjob") {
    current.job = arg;
    await db.users.put(current);
    println(`✅ Job set: ${arg}`);
  }

  else if (base === "quitjob") {
    current.job = null;
    await db.users.put(current);
    println(`🚪 You quit your job.`);
  }

  else if (base === "bizlist") {
    for (let [n, b] of Object.entries(businesses)) println(`${n} - $${b.price} / income: $${b.income}`);
  }

  else if (base === "buybiz") {
    const biz = businesses[arg];
    if (!biz || current.balance < biz.price) return println("❌ Invalid biz or insufficient funds.");
    current.balance -= biz.price;
    current.business = arg;
    await db.users.put(current);
    const bank = await db.bank.get(1);
    bank.balance += biz.price;
    await db.bank.put(bank);
    println(`🏢 Bought biz: ${arg}`);
  }

  else if (base === "sellbiz") {
    if (!current.business) return println("❌ No biz to sell.");
    const price = businesses[current.business].price;
    const refund = Math.floor(price * 0.5);
    current.balance += refund;
    const bank = await db.bank.get(1);
    bank.balance -= refund;
    current.business = null;
    await db.users.put(current);
    await db.bank.put(bank);
    println("🏢 Sold biz.");
  }

  else if (base === "itemlist") {
    const items = await db.market.toArray();
    items.forEach(i => println(`${i.item} - $${i.price}`));
  }

  else if (base === "buyitem") {
    const [emoji, qty] = [args[0], parseInt(args[1])];
    const item = await db.market.get(emoji);
    if (!item || qty <= 0 || current.balance < item.price * qty) return println("❌ Invalid item/qty/funds.");
    current.balance -= item.price * qty;
    current.inventory[emoji] = (current.inventory[emoji] || 0) + qty;
    await db.users.put(current);
    const bank = await db.bank.get(1);
    bank.balance += item.price * qty;
    await db.bank.put(bank);
    println(`🛒 Bought ${qty} ${emoji}`);
  }

  else if (base === "sellitem") {
    const [emoji, qty] = [args[0], parseInt(args[1])];
    if ((current.inventory[emoji] || 0) < qty) return println("❌ Not enough items.");
    const item = await db.market.get(emoji);
    const refund = Math.floor(item.price * 0.2) * qty;
    current.inventory[emoji] -= qty;
    current.balance += refund;
    const bank = await db.bank.get(1);
    bank.balance -= refund;
    await db.users.put(current);
    await db.bank.put(bank);
    println(`💰 Sold ${qty} ${emoji}`);
  }

  else if (base === "inventory") {
    println("🎒 Inventory:");
    for (let [emoji, qty] of Object.entries(current.inventory || {})) {
      if (qty > 0) println(`${emoji} x${qty}`);
    }
  }

  else if (base === "buyhouse") {
    if (!houses[arg] || current.balance < houses[arg]) return println("❌ Invalid house.");
    current.balance -= houses[arg];
    current.house = arg;
    const bank = await db.bank.get(1);
    bank.balance += houses[arg];
    await db.bank.put(bank);
    await db.users.put(current);
    println("🏠 Bought house.");
  }

  else if (base === "sellhouse") {
    if (!current.house) return println("❌ No house to sell.");
    const refund = Math.floor(houses[current.house] * 0.2);
    current.balance += refund;
    const bank = await db.bank.get(1);
    bank.balance -= refund;
    current.house = null;
    await db.users.put(current);
    await db.bank.put(bank);
    println("🏠 Sold house.");
  }

  else if (base === "crime") {
    const chance = Math.random();
    if (chance < 0.4) return println("🚓 Caught! You're jailed.");
    const steal = Math.floor(Math.random() * 100);
    current.balance += steal;
    const bank = await db.bank.get(1);
    bank.balance -= steal;
    await db.users.put(current);
    await db.bank.put(bank);
    println(`🦹 Success! Stole $${steal}`);
  }

  else if (base === "charity") {
    const amt = parseInt(arg);
    if (current.balance < amt) return println("❌ Insufficient funds.");
    current.balance -= amt;
    const bank = await db.bank.get(1);
    bank.balance += amt;
    await db.users.put(current);
    await db.bank.put(bank);
    println("🙏 Thank you for your donation.");
  }

  else if (base === "travel") {
    const chance = Math.random();
    const emoji = chance < 0.5 ? "📟" : "📦";
    current.inventory[emoji] = (current.inventory[emoji] || 0) + 1;
    await db.users.put(current);
    println(`✈️ Traveled and found: ${emoji}`);
  }

  else if (base === "life") {
    const life = Math.floor((Date.now() - current.signedAt) / 3600000);
    println(`⏳ Total playtime: ${life} hours`);
  }

  else if (base === "profile" || base === "stats") {
    println(`🧑 Tag: ${current.tag}\n💰 $${current.balance}\n💼 ${current.job || "-"}\n🏢 ${current.business || "-"}\n🏠 ${current.house || "-"}\n🎒 Items: ${Object.keys(current.inventory || {}).length}`);
  }

  else if (base === "bank") {
    if (current.tag !== adminTag) return println("❌ Admin only.");
    if (args[0] === "view") {
      const bank = await db.bank.get(1);
      println(`🏦 Bank Z: $${bank.balance}`);
    } else if (args[0] === "set") {
      const amt = parseInt(args[1]);
      const bank = await db.bank.get(1);
      bank.balance = amt;
      await db.bank.put(bank);
      println("✅ Bank updated.");
    }
  }

  else if (base === "save") {
    saveData();
  }

  else if (base === "load") {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async e => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        await db.delete();
        await setupBank();
        await setupMarket();
        for (const obj of data) {
          if (obj.singleton) await db.bank.put(obj);
          else if (obj.item) await db.market.put(obj);
          else await db.users.put(obj);
        }
        println("✅ Backup loaded. Refreshing...");
        setTimeout(() => location.reload(), 500);
      } catch {
        println("❌ Invalid file.");
      }
    };
    input.click();
  }
};

$input.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const cmd = $input.value.trim();
    $input.value = "";
    println("» " + cmd);
    dispatch(cmd);
  }
});

setup();
