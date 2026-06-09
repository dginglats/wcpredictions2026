import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const matches = [
  // GROUP A
  { ht:"Мексика", at:"ЮАР", hf:"🇲🇽", af:"🇿🇦", k:"2026-06-11T19:00:00Z", s:"Estadio Azteca", c:"Мехико", g:"A" },
  { ht:"Южная Корея", at:"Чехия", hf:"🇰🇷", af:"🇨🇿", k:"2026-06-12T02:00:00Z", s:"Estadio Akron", c:"Гвадалахара", g:"A" },
  { ht:"Чехия", at:"ЮАР", hf:"🇨🇿", af:"🇿🇦", k:"2026-06-18T16:00:00Z", s:"Mercedes-Benz Stadium", c:"Атланта", g:"A" },
  { ht:"Мексика", at:"Южная Корея", hf:"🇲🇽", af:"🇰🇷", k:"2026-06-19T01:00:00Z", s:"Estadio Akron", c:"Гвадалахара", g:"A" },
  { ht:"Чехия", at:"Мексика", hf:"🇨🇿", af:"🇲🇽", k:"2026-06-25T01:00:00Z", s:"Estadio Azteca", c:"Мехико", g:"A" },
  { ht:"ЮАР", at:"Южная Корея", hf:"🇿🇦", af:"🇰🇷", k:"2026-06-25T01:00:00Z", s:"Estadio BBVA", c:"Монтеррей", g:"A" },
  // GROUP B
  { ht:"Канада", at:"Босния и Герц.", hf:"🇨🇦", af:"🇧🇦", k:"2026-06-12T19:00:00Z", s:"BMO Field", c:"Торонто", g:"B" },
  { ht:"Катар", at:"Швейцария", hf:"🇶🇦", af:"🇨🇭", k:"2026-06-13T19:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"B" },
  { ht:"Швейцария", at:"Босния и Герц.", hf:"🇨🇭", af:"🇧🇦", k:"2026-06-18T19:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"B" },
  { ht:"Канада", at:"Катар", hf:"🇨🇦", af:"🇶🇦", k:"2026-06-18T22:00:00Z", s:"BC Place", c:"Ванкувер", g:"B" },
  { ht:"Швейцария", at:"Канада", hf:"🇨🇭", af:"🇨🇦", k:"2026-06-24T19:00:00Z", s:"BC Place", c:"Ванкувер", g:"B" },
  { ht:"Босния и Герц.", at:"Катар", hf:"🇧🇦", af:"🇶🇦", k:"2026-06-24T19:00:00Z", s:"Lumen Field", c:"Сиэтл", g:"B" },
  // GROUP C
  { ht:"Бразилия", at:"Марокко", hf:"🇧🇷", af:"🇲🇦", k:"2026-06-13T22:00:00Z", s:"MetLife Stadium", c:"Нью-Йорк/НДж", g:"C" },
  { ht:"Гаити", at:"Шотландия", hf:"🇭🇹", af:"🏴󠁧󠁢󠁳󠁣󠁴󠁿", k:"2026-06-14T01:00:00Z", s:"Gillette Stadium", c:"Фоксборо", g:"C" },
  { ht:"Шотландия", at:"Марокко", hf:"🏴󠁧󠁢󠁳󠁣󠁴󠁿", af:"🇲🇦", k:"2026-06-19T22:00:00Z", s:"Gillette Stadium", c:"Фоксборо", g:"C" },
  { ht:"Бразилия", at:"Гаити", hf:"🇧🇷", af:"🇭🇹", k:"2026-06-20T00:30:00Z", s:"Lincoln Financial Field", c:"Филадельфия", g:"C" },
  { ht:"Шотландия", at:"Бразилия", hf:"🏴󠁧󠁢󠁳󠁣󠁴󠁿", af:"🇧🇷", k:"2026-06-24T22:00:00Z", s:"Hard Rock Stadium", c:"Майами", g:"C" },
  { ht:"Марокко", at:"Гаити", hf:"🇲🇦", af:"🇭🇹", k:"2026-06-24T22:00:00Z", s:"Mercedes-Benz Stadium", c:"Атланта", g:"C" },
  // GROUP D
  { ht:"США", at:"Парагвай", hf:"🇺🇸", af:"🇵🇾", k:"2026-06-13T01:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"D" },
  { ht:"Австралия", at:"Турция", hf:"🇦🇺", af:"🇹🇷", k:"2026-06-14T04:00:00Z", s:"BC Place", c:"Ванкувер", g:"D" },
  { ht:"США", at:"Австралия", hf:"🇺🇸", af:"🇦🇺", k:"2026-06-19T19:00:00Z", s:"Lumen Field", c:"Сиэтл", g:"D" },
  { ht:"Турция", at:"Парагвай", hf:"🇹🇷", af:"🇵🇾", k:"2026-06-20T03:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"D" },
  { ht:"Турция", at:"США", hf:"🇹🇷", af:"🇺🇸", k:"2026-06-26T02:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"D" },
  { ht:"Парагвай", at:"Австралия", hf:"🇵🇾", af:"🇦🇺", k:"2026-06-26T02:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"D" },
  // GROUP E
  { ht:"Германия", at:"Кюрасао", hf:"🇩🇪", af:"🇨🇼", k:"2026-06-14T17:00:00Z", s:"NRG Stadium", c:"Хьюстон", g:"E" },
  { ht:"Кот-д'Ивуар", at:"Эквадор", hf:"🇨🇮", af:"🇪🇨", k:"2026-06-14T23:00:00Z", s:"Lincoln Financial Field", c:"Филадельфия", g:"E" },
  { ht:"Германия", at:"Кот-д'Ивуар", hf:"🇩🇪", af:"🇨🇮", k:"2026-06-20T20:00:00Z", s:"BMO Field", c:"Торонто", g:"E" },
  { ht:"Эквадор", at:"Кюрасао", hf:"🇪🇨", af:"🇨🇼", k:"2026-06-21T00:00:00Z", s:"Arrowhead Stadium", c:"Канзас-Сити", g:"E" },
  { ht:"Кюрасао", at:"Кот-д'Ивуар", hf:"🇨🇼", af:"🇨🇮", k:"2026-06-25T20:00:00Z", s:"Lincoln Financial Field", c:"Филадельфия", g:"E" },
  { ht:"Эквадор", at:"Германия", hf:"🇪🇨", af:"🇩🇪", k:"2026-06-25T20:00:00Z", s:"MetLife Stadium", c:"Нью-Йорк/НДж", g:"E" },
  // GROUP F
  { ht:"Нидерланды", at:"Япония", hf:"🇳🇱", af:"🇯🇵", k:"2026-06-14T20:00:00Z", s:"AT&T Stadium", c:"Даллас", g:"F" },
  { ht:"Швеция", at:"Тунис", hf:"🇸🇪", af:"🇹🇳", k:"2026-06-15T02:00:00Z", s:"Estadio BBVA", c:"Монтеррей", g:"F" },
  { ht:"Нидерланды", at:"Швеция", hf:"🇳🇱", af:"🇸🇪", k:"2026-06-20T17:00:00Z", s:"Estadio BBVA", c:"Монтеррей", g:"F" },
  { ht:"Тунис", at:"Япония", hf:"🇹🇳", af:"🇯🇵", k:"2026-06-21T04:00:00Z", s:"NRG Stadium", c:"Хьюстон", g:"F" },
  { ht:"Япония", at:"Швеция", hf:"🇯🇵", af:"🇸🇪", k:"2026-06-25T23:00:00Z", s:"Estadio BBVA", c:"Монтеррей", g:"F" },
  { ht:"Тунис", at:"Нидерланды", hf:"🇹🇳", af:"🇳🇱", k:"2026-06-25T23:00:00Z", s:"AT&T Stadium", c:"Даллас", g:"F" },
  // GROUP G
  { ht:"Бельгия", at:"Египет", hf:"🇧🇪", af:"🇪🇬", k:"2026-06-15T19:00:00Z", s:"Lumen Field", c:"Сиэтл", g:"G" },
  { ht:"Иран", at:"Новая Зеландия", hf:"🇮🇷", af:"🇳🇿", k:"2026-06-16T01:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"G" },
  { ht:"Бельгия", at:"Иран", hf:"🇧🇪", af:"🇮🇷", k:"2026-06-21T19:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"G" },
  { ht:"Новая Зеландия", at:"Египет", hf:"🇳🇿", af:"🇪🇬", k:"2026-06-22T01:00:00Z", s:"SoFi Stadium", c:"Лос-Анджелес", g:"G" },
  { ht:"Египет", at:"Иран", hf:"🇪🇬", af:"🇮🇷", k:"2026-06-27T03:00:00Z", s:"BC Place", c:"Ванкувер", g:"G" },
  { ht:"Новая Зеландия", at:"Бельгия", hf:"🇳🇿", af:"🇧🇪", k:"2026-06-27T03:00:00Z", s:"Lumen Field", c:"Сиэтл", g:"G" },
  // GROUP H
  { ht:"Испания", at:"Кабо-Верде", hf:"🇪🇸", af:"🇨🇻", k:"2026-06-15T16:00:00Z", s:"Mercedes-Benz Stadium", c:"Атланта", g:"H" },
  { ht:"Саудовская Аравия", at:"Уругвай", hf:"🇸🇦", af:"🇺🇾", k:"2026-06-15T22:00:00Z", s:"Hard Rock Stadium", c:"Майами", g:"H" },
  { ht:"Испания", at:"Саудовская Аравия", hf:"🇪🇸", af:"🇸🇦", k:"2026-06-21T16:00:00Z", s:"Mercedes-Benz Stadium", c:"Атланта", g:"H" },
  { ht:"Уругвай", at:"Кабо-Верде", hf:"🇺🇾", af:"🇨🇻", k:"2026-06-21T22:00:00Z", s:"Hard Rock Stadium", c:"Майами", g:"H" },
  { ht:"Кабо-Верде", at:"Саудовская Аравия", hf:"🇨🇻", af:"🇸🇦", k:"2026-06-27T00:00:00Z", s:"NRG Stadium", c:"Хьюстон", g:"H" },
  { ht:"Уругвай", at:"Испания", hf:"🇺🇾", af:"🇪🇸", k:"2026-06-27T00:00:00Z", s:"Estadio Akron", c:"Гвадалахара", g:"H" },
  // GROUP I
  { ht:"Франция", at:"Сенегал", hf:"🇫🇷", af:"🇸🇳", k:"2026-06-16T19:00:00Z", s:"MetLife Stadium", c:"Нью-Йорк/НДж", g:"I" },
  { ht:"Ирак", at:"Норвегия", hf:"🇮🇶", af:"🇳🇴", k:"2026-06-16T22:00:00Z", s:"Gillette Stadium", c:"Фоксборо", g:"I" },
  { ht:"Франция", at:"Ирак", hf:"🇫🇷", af:"🇮🇶", k:"2026-06-22T21:00:00Z", s:"Gillette Stadium", c:"Фоксборо", g:"I" },
  { ht:"Норвегия", at:"Сенегал", hf:"🇳🇴", af:"🇸🇳", k:"2026-06-23T00:00:00Z", s:"Lincoln Financial Field", c:"Филадельфия", g:"I" },
  { ht:"Норвегия", at:"Франция", hf:"🇳🇴", af:"🇫🇷", k:"2026-06-26T19:00:00Z", s:"MetLife Stadium", c:"Нью-Йорк/НДж", g:"I" },
  { ht:"Сенегал", at:"Ирак", hf:"🇸🇳", af:"🇮🇶", k:"2026-06-26T19:00:00Z", s:"BMO Field", c:"Торонто", g:"I" },
  // GROUP J
  { ht:"Аргентина", at:"Алжир", hf:"🇦🇷", af:"🇩🇿", k:"2026-06-17T01:00:00Z", s:"Arrowhead Stadium", c:"Канзас-Сити", g:"J" },
  { ht:"Австрия", at:"Иордания", hf:"🇦🇹", af:"🇯🇴", k:"2026-06-17T04:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"J" },
  { ht:"Аргентина", at:"Австрия", hf:"🇦🇷", af:"🇦🇹", k:"2026-06-22T17:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"J" },
  { ht:"Иордания", at:"Алжир", hf:"🇯🇴", af:"🇩🇿", k:"2026-06-23T03:00:00Z", s:"AT&T Stadium", c:"Даллас", g:"J" },
  { ht:"Алжир", at:"Австрия", hf:"🇩🇿", af:"🇦🇹", k:"2026-06-28T02:00:00Z", s:"Levi's Stadium", c:"Санта-Клара", g:"J" },
  { ht:"Иордания", at:"Аргентина", hf:"🇯🇴", af:"🇦🇷", k:"2026-06-28T02:00:00Z", s:"Arrowhead Stadium", c:"Канзас-Сити", g:"J" },
  // GROUP K
  { ht:"Португалия", at:"ДР Конго", hf:"🇵🇹", af:"🇨🇩", k:"2026-06-17T17:00:00Z", s:"NRG Stadium", c:"Хьюстон", g:"K" },
  { ht:"Узбекистан", at:"Колумбия", hf:"🇺🇿", af:"🇨🇴", k:"2026-06-18T02:00:00Z", s:"Estadio Azteca", c:"Мехико", g:"K" },
  { ht:"Португалия", at:"Узбекистан", hf:"🇵🇹", af:"🇺🇿", k:"2026-06-23T17:00:00Z", s:"Estadio Azteca", c:"Мехико", g:"K" },
  { ht:"Колумбия", at:"ДР Конго", hf:"🇨🇴", af:"🇨🇩", k:"2026-06-24T02:00:00Z", s:"NRG Stadium", c:"Хьюстон", g:"K" },
  { ht:"Колумбия", at:"Португалия", hf:"🇨🇴", af:"🇵🇹", k:"2026-06-27T23:30:00Z", s:"Hard Rock Stadium", c:"Майами", g:"K" },
  { ht:"ДР Конго", at:"Узбекистан", hf:"🇨🇩", af:"🇺🇿", k:"2026-06-27T23:30:00Z", s:"Mercedes-Benz Stadium", c:"Атланта", g:"K" },
  // GROUP L
  { ht:"Англия", at:"Хорватия", hf:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", af:"🇭🇷", k:"2026-06-17T20:00:00Z", s:"AT&T Stadium", c:"Даллас", g:"L" },
  { ht:"Гана", at:"Панама", hf:"🇬🇭", af:"🇵🇦", k:"2026-06-17T23:00:00Z", s:"BMO Field", c:"Торонто", g:"L" },
  { ht:"Англия", at:"Гана", hf:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", af:"🇬🇭", k:"2026-06-23T20:00:00Z", s:"BMO Field", c:"Торонто", g:"L" },
  { ht:"Панама", at:"Хорватия", hf:"🇵🇦", af:"🇭🇷", k:"2026-06-23T23:00:00Z", s:"Gillette Stadium", c:"Фоксборо", g:"L" },
  { ht:"Панама", at:"Англия", hf:"🇵🇦", af:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", k:"2026-06-27T21:00:00Z", s:"MetLife Stadium", c:"Нью-Йорк/НДж", g:"L" },
  { ht:"Хорватия", at:"Гана", hf:"🇭🇷", af:"🇬🇭", k:"2026-06-27T21:00:00Z", s:"Lincoln Financial Field", c:"Филадельфия", g:"L" },
];

const esc = (s) => s.replace(/'/g, "''");

const lines = matches.map(
  (m) =>
    `INSERT INTO public.matches (home_team,away_team,home_flag,away_flag,kickoff,stadium,city,stage,group_name,status) ` +
    `VALUES ('${esc(m.ht)}','${esc(m.at)}','${esc(m.hf)}','${esc(m.af)}','${m.k}','${esc(m.s)}','${esc(m.c)}','group','${m.g}','scheduled');`
);

const sql =
  `-- WC 2026 Group Stage Matches (${matches.length} total)\n` +
  `-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql\n\n` +
  `DELETE FROM public.matches WHERE stage = 'group';\n\n` +
  lines.join("\n");

const outPath = resolve(__dirname, "seed-matches.sql");
writeFileSync(outPath, sql, "utf-8");
console.log(`✅ Generated scripts/seed-matches.sql with ${matches.length} matches`);
console.log(`   Open: https://supabase.com/dashboard/project/_/sql`);
console.log(`   Paste the contents of scripts/seed-matches.sql and click Run`);
