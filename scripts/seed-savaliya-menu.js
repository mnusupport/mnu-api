#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seeds the Savaliya Ice Cream menu (parsed from the PDF menu) into MongoDB.
 *
 *   node scripts/seed-savaliya-menu.js --dry-run     # show the plan, write nothing
 *   node scripts/seed-savaliya-menu.js               # write (local DB)
 *   node scripts/seed-savaliya-menu.js --yes         # write (required for non-localhost / Atlas)
 *
 * Collections / fields match the existing Mongoose schemas exactly:
 *   Category : restaurantId, name, sortOrder (+ createdAt/updatedAt)
 *   MenuItem : restaurantId, categoryId, name, description, price, isAvailable,
 *              sortOrder, isFeatured, imageUrl, imagePublicId (+ createdAt/updatedAt)
 * Prices are plain rupee numbers. No other fields are added.
 *
 * Re-run safe: categories are matched by (restaurantId, name) and items by
 * (restaurantId, categoryId, name). Existing rows are only updated if their
 * price / description / sortOrder differ. isAvailable, isFeatured and images
 * are never touched on existing items, and items you added by hand are never
 * deleted.
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Reads mnu-api/.env (the same file the API uses), then ./.env as a fallback.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const RESTAURANT_ID = process.env.SEED_RESTAURANT_ID || '6ac87fea5f1bf179a201e3f1';
const RESTAURANT_NAME = process.env.SEED_RESTAURANT_NAME || 'Savaliya';

const DRY_RUN = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');

// [name, price in rupees, description or null]
const MENU = [
  { category: 'Scoops (120 ml)', items: [
    ['Vanilla', 30, 'Smooth, creamy and timeless, a flavour everyone loves.'],
    ['Kaju Draksh', 50, 'Creamy indulgence with cashews and juicy raisins in every bite.'],
    ['Rajbhog', 60, 'Rich, creamy and nutty, inspired by royal Indian flavours.'],
    ['China King', 60, 'A rich, nutty delight made for true ice-cream lovers.'],
    ['American Dryfruits', 60, 'Creamy ice cream loaded with delicious crunchy dry fruits.'],
    ['Choco Chips', 55, 'Rich, chocolatey and creamy, with irresistible choco-chip crunch.'],
    ['Caramel Dryfruit', 70, 'Rich caramel sweetness with delicious dry-fruit crunch.'],
    ['Banana Strawberry', 80, 'Sweet banana meets juicy strawberry in a creamy fruity delight.'],
    ['Tiramisu', 70, 'Creamy, coffee-rich and indulgent, inspired by the classic Tiramisu.'],
    ['Pistachio Caramel', 170, 'Nutty pistachio meets rich caramel for a luxurious creamy treat.'],
    ['Cassata', 65, 'Layers of fruity flavours and cream in a delightful classic favourite.'],
    ['Lotus Biscoff', 90, 'Creamy caramelised biscuit goodness with an irresistible Biscoff crunch.'],
    ['Chocolate Oreo', 70, 'Rich chocolate ice cream loaded with irresistible Oreo crunch.'],
    ['Hira Moti', 65, 'Creamy, rich and beautifully nutty, a truly royal ice-cream treat.'],
    ['Sp. Anjeer', 75, 'Creamy indulgence with the rich, naturally sweet taste of anjeer.'],
    ['Japani Hungama', 60, 'A creamy, flavourful delight with a deliciously unique twist.'],
    ['Mexican Khajana', 60, 'Rich, creamy and packed with delicious nutty surprises.'],
    ['Butter Scotch', 50, 'Smooth, creamy butterscotch with irresistible caramel crunch.'],
    ['Dryfruit Khajana', 65, 'Creamy indulgence packed with rich and crunchy dry fruits.'],
    ['Winter Cream', 65, 'Smooth, creamy and comforting, a perfect winter indulgence.'],
    ['Popcorn Caramel', 90, 'Sweet caramel meets popcorn crunch for a fun, irresistible treat.'],
    ['Golden Pearl', 60, 'Rich, creamy and delightfully nutty, with a touch of golden sweetness.'],
    ['Mava Malai', 50, 'Silky, rich and irresistibly creamy, with an authentic mava flavour.'],
    ['Pan Masala', 60, 'A unique creamy blend with the refreshing taste of pan masala.'],
    ['Blue Diamond', 50, 'Creamy, refreshing and colourful, a delightful treat for every mood.'],
    ['Cookies Cream', 50, 'Creamy ice cream loaded with irresistible crunchy cookie bits.'],
    ['Kesar Pista', 65, 'Fragrant kesar meets crunchy pista in a rich, creamy indulgence.'],
    ['Crunchy Munchy', 55, 'Creamy, nutty and loaded with delicious crunchy surprises.'],
    ['Belgium Dark Chocolate', 75, 'Deep, rich Belgian chocolate for an intense chocolate experience.'],
    ['White House', 60, 'Smooth, rich and delightfully creamy, a luxurious treat in every scoop.'],
  ] },
  { category: 'Sugar Free Scoops (120 ml)', items: [
    ['Vanilla', 40, 'Smooth, creamy and timeless, without the added sugar.'],
    ['Dryfruit', 60, 'Rich creamy indulgence packed with delicious dry fruits.'],
    ['Green Pista', 65, 'Nutty, creamy pistachio goodness without the added sugar.'],
  ] },
  { category: 'Natural (Vegetable) Ice Cream', items: [
    ['Ginger Icecream', 50, 'Smooth, creamy ginger with a warm spicy twist.'],
    ['Green Chilli Icecream', 50, 'Creamy ice cream with a bold chilli kick.'],
    ['Mint Icecream', 50, 'Cool, refreshing mint with a creamy finish.'],
    ['Coriander Icecream', 50, 'Fresh coriander blended into a creamy, unique treat.'],
  ] },
  { category: 'Fruit Ice Cream (Seasonal)', items: [
    ['Mango', 60, null],
    ['Jamboo', 60, null],
    ['Wild Berry', 90, null],
    ['Royal Muskmelon', 90, null],
    ['Jamfal', 60, null],
    ['Tender Coconut', 70, null],
    ['Sitaphal', 60, null],
    ['Strawberry', 60, null],
  ] },
  { category: 'Topping Ice Cream', items: [
    ['Pineapple', 60, 'Creamy vanilla ice cream drizzled with bright, juicy pineapple topping.'],
    ['Blueberry', 60, 'Smooth, creamy ice cream topped with rich and fruity blueberry sauce.'],
    ['Chocolate', 60, 'Creamy ice cream covered in rich chocolate sauce and crunchy chocolate bits.'],
    ['Rabdi Falooda', 120, 'Rich rabdi, silky ice cream & classic falooda flavours in every scoop.'],
    ['Strawberry Cashew', 80, 'Creamy strawberry ice cream topped with juicy strawberry sauce and crunchy cashews.'],
    ['Crunchy Oreo', 70, 'Creamy ice cream loaded with crunchy Oreo pieces and chocolate drizzle.'],
    ['Chocolate Mania', 100, 'Rich chocolate ice cream layered with silky chocolate sauce and crunchy toppings.'],
    ['Mango Cashew', 80, 'Creamy ice cream topped with juicy mango sauce and crunchy cashews.'],
  ] },
  { category: 'Sundae Ice Cream', items: [
    ['Dawat', 350, 'Royal · Loaded · Indulgent'],
    ['Chocolate Brownie Safari', 220, 'Fudgy · Chocolatey · Rich'],
    ['Chocolate Fantacy', 240, 'Creamy · Nutty · Crunchy'],
    ['Oreo Original', 200, 'Creamy · Crunchy · Chocolaty'],
    ['Check Mate', 240, 'Fudgy · Chocolatey · Rich'],
    ['Tall Beauty', 200, 'Creamy · Loaded · Indulgent'],
    ['Mix Plater', 270, 'Variety · Creamy · Delicious'],
    ['Tripple Sundae', 200, 'Layered · Fruity · Decadent'],
    ['Titanic Boat', 170, 'Grand · Loaded · Celebration'],
  ] },
  { category: 'Brownies & Desserts', items: [
    ['Walnut Brownie', 130, 'Rich, fudgy brownie topped with crunchy walnuts.'],
    ['Sizzling Brownie With Vanilla', 230, 'Warm brownie served with creamy vanilla ice cream.'],
    ['Sizzling Brownie With KitKat', 250, 'Warm brownie topped with ice cream, chocolate sauce, and KitKat.'],
    ['Sizzling Carrot Halwa (Seasonal)', 200, 'Warm, rich carrot halwa topped with creamy vanilla ice cream and crunchy dry fruits.'],
    ['Sizzling Brownie With Dryfruit', 300, 'Warm, fudgy brownie topped with dryfruit ice cream, chocolate sauce, cadbury and crunchy dry fruits.'],
    ['Hot Brownie With Chocolate', 120, 'Warm, fudgy brownie topped with rich chocolate sauce and creamy ice cream.'],
    ['Hot Brownie With Nutella', 120, 'Warm, chocolatey brownie topped with smooth and creamy Nutella.'],
    ['Hot Brownie With Vanilla', 100, 'Warm, fudgy brownie served with creamy vanilla ice cream and chocolate drizzle.'],
    ['Chocolate Velvet Brownie', 150, 'Rich, moist chocolate brownie with a smooth, indulgent chocolate flavour.'],
  ] },
  { category: "Kid's Special", items: [
    ["Kid's Special", 70, 'Warm, gooey brownie topped with creamy vanilla ice cream and colorful sprinkles.'],
    ['Kidy Joker', 120, 'A fun, indulgent dessert with rich brownie, creamy ice cream and delightful toppings.'],
  ] },
  { category: 'Cold Coffee', items: [
    ['Cold Coffee Chocolate', 110, 'Creamy cold coffee with rich chocolate.'],
    ['Caramel Coffee', 160, 'Creamy cold coffee with sweet caramel drizzle.'],
    ['Cold Coffee', 100, 'Smooth cold coffee blended with fresh milk.'],
    ['Iced Americano', 100, null],
    ['Affogato Coffee', 120, null],
    ['Irish Coffee', 150, null],
    ['Smoked Oak Coffee', 160, null],
    ['French Vanilla Coffee', 150, null],
  ] },
  { category: 'Hot Beverages', items: [
    ['Hot Coffee', 80, 'Rich · Warm · Classic'],
    ['Kesar Badam Milk', 100, 'Rich · Kesar · Indulgent'],
    ['Espresso', 100, 'Strong · Aromatic · Intense'],
    ['Hot Italian Chocolate', 120, null],
    ['Hot Chocolate', 100, null],
  ] },
  { category: 'Milk Shakes (300 ml)', items: [
    ['Oreo Milk Shake', 100, 'Creamy Oreo with chocolate crunch.'],
    ['Milk Rose Shake', 100, 'Sweet rose with creamy richness.'],
    ['Kaju Anjeer Shake', 160, 'Rich cashew and fig blend.'],
    ['Mango Shake', 100, 'Smooth, creamy mango delight.'],
    ['Strawberry Shake', 100, 'Fresh strawberry, creamy and sweet.'],
    ['Pineapple Shake', 100, 'Tropical pineapple with creamy goodness.'],
    ['Kesar Shake', 100, 'Rich saffron with creamy indulgence.'],
    ['Kaju Shake', 160, 'Creamy cashew with nutty richness.'],
  ] },
  { category: 'Thick Shakes (300 ml)', items: [
    ['Brownie Oreo Kitkat', 250, 'Brownie, Oreo & KitKat delight.'],
    ['Caramel', 200, 'Smooth, creamy caramel indulgence.'],
    ['Nutella Kitkat', 230, 'Nutella loaded with KitKat crunch.'],
    ['Ferrero Rocher', 250, 'Rich chocolate & hazelnut bliss.'],
    ['Kitkat', 190, 'Creamy chocolate with KitKat crunch.'],
    ['Chocolate Dip', 180, 'Rich chocolate shake with a decadent dip.'],
    ['Lotus Biscoff', 250, 'Creamy Biscoff with irresistible caramel crunch.'],
    ['Kaju Anjeer', 220, 'Creamy cashew and fig delight.'],
    ['Red Velvet', 200, 'Velvety red velvet with creamy richness.'],
    ['Royal Kesar Dryfruit', 250, 'Fruity, creamy, and loaded with nuts.'],
    ['Pineapple', 160, 'Creamy pineapple with a tropical twist.'],
    ['Strawberry', 160, 'Sweet strawberry with creamy goodness.'],
    ['Blueberry', 170, 'Creamy blueberry with a fruity burst.'],
    ['Chocolate Oreo', 190, 'Rich chocolate with Oreo crunch.'],
    ['Vanilla', 120, 'Smooth, creamy classic vanilla.'],
    ['Fruit & Nut', 260, 'Creamy fruit blend loaded with crunchy nuts and rich indulgence.'],
  ] },
  { category: 'Tea & Chill (250 ml)', items: [
    ['Lemon Iced Tea', 100, 'Zesty lemon tea, chilled with ice for a refreshing sip.'],
    ['Peach Iced Tea', 100, 'Sweet peach and refreshing tea, served chilled over ice.'],
    ['Green Apple Iced Tea', 100, 'Crisp green apple meets refreshing iced tea. A cool, tangy sip with a fruity twist.'],
  ] },
  { category: 'Lassi (250 ml)', items: [
    ['Sweet Heart Lassi', 50, 'Creamy lassi with a sweet and refreshing strawberry swirl.'],
    ['Kesar Lassi', 70, 'Creamy lassi infused with aromatic saffron and rich sweetness.'],
    ['Kesar Rajwadi', 120, 'Rich and creamy kesar lassi with a smooth royal flavour.'],
    ['Kesar Nut Bliss', 100, 'Creamy kesar lassi topped with crunchy nuts for a delightful taste.'],
    ['Shan-E-Rajwadi', 100, 'Rich, creamy lassi with fruity flavours and a royal nutty touch.'],
    ['Strawberry Lassi', 80, 'Creamy, refreshing lassi blended with juicy strawberries for a sweet, fruity delight.'],
    ['Mango Kaju Lassi', 110, 'Creamy, rich lassi blended with premium cashews for a smooth, nutty, and indulgent taste.'],
    ['Rose Dryfruit Lassi', 90, 'A rich and creamy rose lassi delicately garnished with a crisp crown of sliced pistachios and almonds.'],
  ] },
  { category: 'Cold Coco (250 ml)', items: [
    ['Cold Coco', 65, null],
    ['Cold Coco With Icecream', 90, null],
    ['Cold Coco With Chips', 90, null],
    ['Cold Coco With Chips And Icecream', 120, null],
    ['Rajwadi Cold Coco', 150, null],
  ] },
  { category: 'All Time Favourite Shakes (250 ml)', items: [
    ['Badam Shake With Icecream', 90, null],
    ['Badam Shake', 60, null],
    ['Chiku Shake (Seasonal)', 70, null],
  ] },
  { category: 'Falooda (250 ml)', items: [
    ['Falooda Rose', 90, null],
    ['Kesar Falooda', 100, null],
    ['Rabadi Falooda', 150, null],
    ['Strawberry Falooda', 100, null],
    ['Chocolate Falooda', 100, null],
    ['Mango Falooda', 100, null],
    ['Pineapple Falooda', 100, null],
    ['Blueberry Falooda', 100, null],
  ] },
  { category: 'Kulfi, Bars & Cones', items: [
    ['Fresh Malai Kulfi', 25, 'Freshly made, rich and creamy kulfi with a smooth malai flavour and traditional Indian sweetness.'],
    ['Chocobar', 25, 'Creamy vanilla ice cream coated in a rich, indulgent chocolate shell for a deliciously crunchy bite.'],
    ['Mango Dolly', 25, 'A refreshing mango ice cream bar bursting with juicy, fruity mango flavour in every bite.'],
    ['Jamun Sorbet Kulfi', 50, 'A creamy, rich kulfi infused with the sweet-tart flavour of juicy jamun.'],
    ['Mini Cone', 15, null],
    ['Butterscotch Cone', 30, null],
    ['Chocolate Cone', 30, null],
    ['Flingo Cone Chocolate', 60, null],
    ['Rasberry Dolly', 20, null],
    ['Flingo Cone Cookies', 50, null],
    ['Funtastic', 40, null],
    ['Bada Bite', 50, null],
  ] },
  { category: 'Sorbet Lollipop & Shots', items: [
    ['Jamun Lollipop', 20, 'Creamy ice cream with the sweet and tangy flavour of juicy jamun, packed into a fun lolipop treat.'],
    ['Guava Lollipop', 20, 'Creamy ice cream bursting with the sweet, tangy flavour of fresh jamphal in every bite.'],
    ['Lychee Lollipop', 20, 'Creamy ice cream with the sweet, juicy flavour of fresh litchi, delivering a refreshing fruity taste in every bite.'],
    ['Jamun Shot', 50, null],
    ['Jamfal Shot', 50, null],
  ] },
  { category: 'Shrikhand Matho (1 KG)', items: [
    ['American Dryfruit', 400, 'Rich, creamy ice cream loaded with crunchy nuts and delicious dry fruits.'],
    ['Rajbhog', 400, 'Royal saffron-infused ice cream packed with rich nuts and traditional flavours.'],
    ['Kaju Draksh', 360, 'Creamy ice cream blended with cashews and sweet, juicy raisins.'],
    ['Kesar Elaichi', 360, 'Fragrant saffron and cardamom blend into a rich, creamy indulgence.'],
  ] },
  { category: 'Dahi & Chass', items: [
    ['Savaliya Dahi (250 GM)', 28, 'Thick, creamy and smooth dahi made with quality milk, perfect for every meal.'],
    ['Savaliya Dahi (450 GM)', 50, 'Thick, creamy and smooth dahi made with quality milk, perfect for every meal.'],
    ['Savaliya Masala Chass (500 ML)', 40, 'Refreshing buttermilk blended with aromatic spices, perfect for a cool, flavorful sip.'],
    ['Savaliya Masala Chass (1 Litre)', 75, 'Refreshing buttermilk blended with aromatic spices, perfect for a cool, flavorful sip.'],
  ] },
  { category: 'Family Pack (750 ml)', items: [
    ['American Dryfruit', 240, null],
    ['Mava Malai', 210, null],
    ['Roasted Dryfruit (sugar free available)', 270, null],
    ['Crunchy Munchy', 220, null],
    ['Rajbhog', 250, null],
    ['Kaju Draksh', 220, null],
    ['Vanilla', 140, null],
    ['Cookies & Cream', 210, null],
    ['Golden Pearl', 270, null],
    ['Choco Chips', 220, null],
    ['White House', 270, null],
    ['Sitafal (Seasonal)', 270, null],
    ['Savaliya Special (China King)', 270, null],
  ] },
];

const EXPECTED_CATEGORIES = 22;
const EXPECTED_ITEMS = 175;

/** Catches typos in the data above before anything touches the database. */
function validateMenu() {
  const problems = [];
  const seenCategories = new Set();
  let itemCount = 0;
  for (const { category, items } of MENU) {
    if (seenCategories.has(category)) problems.push(`Duplicate category "${category}"`);
    seenCategories.add(category);
    const seenItems = new Set();
    for (const [name, price, description] of items) {
      itemCount += 1;
      if (!name || typeof name !== 'string') problems.push(`Bad item name in "${category}"`);
      if (seenItems.has(name)) problems.push(`Duplicate item "${name}" in "${category}"`);
      seenItems.add(name);
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) problems.push(`Bad price for "${name}" in "${category}": ${price}`);
      if (description !== null && typeof description !== 'string') problems.push(`Bad description for "${name}" in "${category}"`);
    }
  }
  if (MENU.length !== EXPECTED_CATEGORIES) problems.push(`Expected ${EXPECTED_CATEGORIES} categories, found ${MENU.length}`);
  if (itemCount !== EXPECTED_ITEMS) problems.push(`Expected ${EXPECTED_ITEMS} items, found ${itemCount}`);
  return problems;
}

function describeTarget(uri) {
  try {
    const u = new URL(uri);
    return { host: u.host, db: u.pathname.replace(/^\//, '') || '(default)', local: ['localhost', '127.0.0.1', '::1'].includes(u.hostname) };
  } catch {
    return { host: '(unparseable)', db: '(unknown)', local: false };
  }
}

async function main() {
  const problems = validateMenu();
  if (problems.length) {
    console.error('Menu data failed validation:\n  - ' + problems.join('\n  - '));
    process.exitCode = 1;
    return;
  }

  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No connection string. Set DATABASE_URL (or MONGODB_URI) in mnu-api/.env.');
    process.exitCode = 1;
    return;
  }
  if (!mongoose.isValidObjectId(RESTAURANT_ID)) {
    console.error(`SEED_RESTAURANT_ID "${RESTAURANT_ID}" is not a valid ObjectId.`);
    process.exitCode = 1;
    return;
  }

  const target = describeTarget(uri);
  console.log(`Target   : ${target.host} / database "${target.db}"`);
  console.log(`Mode     : ${DRY_RUN ? 'DRY RUN (nothing will be written)' : 'WRITE'}`);

  if (!DRY_RUN && !target.local && !YES) {
    console.error('\nThis is not a localhost database. Re-run with --yes to confirm you want to write to it,');
    console.error('or run with --dry-run first to preview.');
    process.exitCode = 1;
    return;
  }

  const restaurantId = new mongoose.Types.ObjectId(RESTAURANT_ID);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    // Collection names are pinned in the schemas ('Restaurant', 'Category', 'MenuItem').
    const restaurants = db.collection('Restaurant');
    const categories = db.collection('Category');
    const menuItems = db.collection('MenuItem');

    const restaurant = await restaurants.findOne({ _id: restaurantId }, { projection: { name: 1 } });
    if (!restaurant) {
      console.error(`\nNo restaurant with _id ${RESTAURANT_ID} in "${target.db}". Nothing was written.`);
      console.error('Check that DATABASE_URL points at the database that contains this restaurant.');
      process.exitCode = 1;
      return;
    }
    if (String(restaurant.name).trim().toLowerCase() !== RESTAURANT_NAME.trim().toLowerCase()) {
      console.error(`\nRestaurant ${RESTAURANT_ID} is named "${restaurant.name}", not "${RESTAURANT_NAME}". Nothing was written.`);
      console.error('Fix SEED_RESTAURANT_ID / SEED_RESTAURANT_NAME if this is intentional.');
      process.exitCode = 1;
      return;
    }
    console.log(`Restaurant: "${restaurant.name}" (${RESTAURANT_ID})\n`);

    // ---- Plan categories ---------------------------------------------------
    const existingCategories = await categories.find({ restaurantId }).toArray();
    const categoryByName = new Map();
    for (const c of existingCategories) if (!categoryByName.has(c.name)) categoryByName.set(c.name, c);

    const stats = {
      categories: { inserted: 0, updated: 0, skipped: 0 },
      items: { inserted: 0, updated: 0, skipped: 0 },
    };
    const now = new Date();

    const categoriesToInsert = [];
    const categoryUpdates = [];
    MENU.forEach(({ category }, index) => {
      const existing = categoryByName.get(category);
      if (!existing) {
        categoriesToInsert.push({ restaurantId, name: category, sortOrder: index, createdAt: now, updatedAt: now });
        stats.categories.inserted += 1;
      } else if (existing.sortOrder !== index) {
        categoryUpdates.push({ updateOne: { filter: { _id: existing._id }, update: { $set: { sortOrder: index, updatedAt: now } } } });
        stats.categories.updated += 1;
      } else {
        stats.categories.skipped += 1;
      }
    });

    if (!DRY_RUN) {
      if (categoriesToInsert.length) {
        const res = await categories.insertMany(categoriesToInsert, { ordered: true });
        categoriesToInsert.forEach((c, i) => categoryByName.set(c.name, { ...c, _id: res.insertedIds[i] }));
      }
      if (categoryUpdates.length) await categories.bulkWrite(categoryUpdates, { ordered: false });
    }

    // ---- Plan items --------------------------------------------------------
    const existingItemByKey = new Map();
    const existingCategoryIds = MENU.map(({ category }) => categoryByName.get(category)?._id).filter(Boolean);
    if (existingCategoryIds.length) {
      const existingItems = await menuItems.find({ restaurantId, categoryId: { $in: existingCategoryIds } }).toArray();
      for (const it of existingItems) {
        const key = `${it.categoryId}|${it.name}`;
        if (!existingItemByKey.has(key)) existingItemByKey.set(key, it);
      }
    }

    const itemsToInsert = [];
    const itemUpdates = [];
    for (const { category, items } of MENU) {
      const cat = categoryByName.get(category); // undefined only in a dry run for a brand-new category
      items.forEach(([name, price, description], index) => {
        const existing = cat ? existingItemByKey.get(`${cat._id}|${name}`) : undefined;
        if (!existing) {
          stats.items.inserted += 1;
          if (!DRY_RUN) {
            itemsToInsert.push({
              restaurantId,
              categoryId: cat._id,
              name,
              description,
              price,
              isAvailable: true,
              sortOrder: index,
              isFeatured: false,
              imageUrl: null,
              imagePublicId: null,
              createdAt: now,
              updatedAt: now,
            });
          }
        } else if (existing.price !== price || (existing.description ?? null) !== description || existing.sortOrder !== index) {
          stats.items.updated += 1;
          itemUpdates.push({ updateOne: { filter: { _id: existing._id }, update: { $set: { price, description, sortOrder: index, updatedAt: now } } } });
        } else {
          stats.items.skipped += 1;
        }
      });
    }

    if (!DRY_RUN) {
      if (itemsToInsert.length) await menuItems.insertMany(itemsToInsert, { ordered: false });
      if (itemUpdates.length) await menuItems.bulkWrite(itemUpdates, { ordered: false });
    }

    // ---- Summary -----------------------------------------------------------
    const verb = DRY_RUN ? 'would be' : 'were';
    console.log(`Summary (${DRY_RUN ? 'dry run, nothing written' : 'written'}):`);
    console.log(`  Categories: ${stats.categories.inserted} ${verb} inserted, ${stats.categories.updated} updated, ${stats.categories.skipped} skipped (unchanged)`);
    console.log(`  Items     : ${stats.items.inserted} ${verb} inserted, ${stats.items.updated} updated, ${stats.items.skipped} skipped (unchanged)`);
    console.log(`  Menu data : ${MENU.length} categories, ${MENU.reduce((n, c) => n + c.items.length, 0)} items`);
    if (DRY_RUN) console.log('\nLooks right? Run again without --dry-run to write.');
  } catch (err) {
    console.error('\nSeed failed:', err && err.message ? err.message : err);
    if (err && err.writeErrors) console.error(`  ${err.writeErrors.length} write error(s); the first: ${err.writeErrors[0].errmsg}`);
    console.error('If it stopped part-way, it is safe to re-run: existing rows are matched, not duplicated.');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main();
