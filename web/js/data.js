// Static reference data: meal catalog + default training split.
(function () {
  const FOODS = [
    { name: "Masala Egg Bhurji + 2 Roti", cat: "Breakfast", emoji: "🍳", cal: 480, p: 26, c: 46, f: 21 },
    { name: "Paneer Bhurji + Toast", cat: "Breakfast", emoji: "🧀", cal: 430, p: 24, c: 34, f: 22 },
    { name: "Vegetable Poha", cat: "Breakfast", emoji: "🍚", cal: 320, p: 7, c: 58, f: 7 },
    { name: "Masala Dosa (2)", cat: "Breakfast", emoji: "🥞", cal: 420, p: 9, c: 66, f: 13 },
    { name: "Idli Sambar (3)", cat: "Breakfast", emoji: "🍥", cal: 340, p: 11, c: 62, f: 5 },
    { name: "Aloo Paratha + Curd", cat: "Breakfast", emoji: "🫓", cal: 520, p: 13, c: 68, f: 22 },
    { name: "Oats + Milk + Banana", cat: "Breakfast", emoji: "🥣", cal: 360, p: 14, c: 60, f: 7 },
    { name: "Whey Protein Scoop", cat: "Breakfast", emoji: "🥤", cal: 120, p: 24, c: 3, f: 1 },

    { name: "Tandoori Chicken + Rice", cat: "Lunch", emoji: "🍗", cal: 630, p: 62, c: 55, f: 15 },
    { name: "Chicken Biryani (plate)", cat: "Lunch", emoji: "🍛", cal: 720, p: 42, c: 82, f: 24 },
    { name: "Palak Paneer + 2 Roti", cat: "Lunch", emoji: "🥬", cal: 640, p: 32, c: 58, f: 30 },
    { name: "Dal Tadka + Rice", cat: "Lunch", emoji: "🍲", cal: 480, p: 19, c: 74, f: 11 },
    { name: "Rajma Chawal", cat: "Lunch", emoji: "🫘", cal: 520, p: 20, c: 84, f: 9 },
    { name: "Butter Chicken + Naan", cat: "Lunch", emoji: "🍜", cal: 850, p: 48, c: 66, f: 44 },
    { name: "Grilled Fish + Veg", cat: "Lunch", emoji: "🐟", cal: 430, p: 52, c: 18, f: 16 },
    { name: "Chole + 2 Roti", cat: "Lunch", emoji: "🍛", cal: 560, p: 21, c: 82, f: 15 },

    { name: "Grilled Chicken Salad", cat: "Office", emoji: "🥗", cal: 380, p: 45, c: 16, f: 15 },
    { name: "Quinoa Bowl + Egg", cat: "Office", emoji: "🍱", cal: 460, p: 24, c: 52, f: 17 },
    { name: "Paneer Tikka Wrap", cat: "Office", emoji: "🌯", cal: 480, p: 22, c: 48, f: 22 },
    { name: "Chicken Sandwich", cat: "Office", emoji: "🥪", cal: 420, p: 32, c: 40, f: 14 },
    { name: "Veg Sushi (8 pc)", cat: "Office", emoji: "🍣", cal: 350, p: 9, c: 66, f: 5 },
    { name: "Lentil Soup + Bread", cat: "Office", emoji: "🍞", cal: 340, p: 17, c: 52, f: 7 },

    { name: "Whey + Banana", cat: "Snack", emoji: "🍌", cal: 225, p: 25, c: 29, f: 2 },
    { name: "Hung Curd (200g)", cat: "Snack", emoji: "🥛", cal: 160, p: 18, c: 12, f: 5 },
    { name: "Roasted Chana (50g)", cat: "Snack", emoji: "🫛", cal: 190, p: 10, c: 30, f: 3 },
    { name: "Almonds (30g)", cat: "Snack", emoji: "🌰", cal: 180, p: 6, c: 6, f: 15 },
    { name: "Boiled Eggs (2)", cat: "Snack", emoji: "🥚", cal: 155, p: 13, c: 1, f: 11 },
    { name: "Protein Bar", cat: "Snack", emoji: "🍫", cal: 210, p: 20, c: 24, f: 7 },
    { name: "Fruit Chaat (bowl)", cat: "Snack", emoji: "🍉", cal: 150, p: 2, c: 36, f: 1 },
    { name: "Green Tea + Digestive", cat: "Snack", emoji: "🍵", cal: 90, p: 1, c: 15, f: 3 },

    { name: "Chicken Reshmi Kebab + Rice", cat: "Dinner", emoji: "🍢", cal: 575, p: 60, c: 52, f: 13 },
    { name: "Grilled Chicken + Steamed Veg", cat: "Dinner", emoji: "🍗", cal: 400, p: 58, c: 14, f: 12 },
    { name: "Paneer Butter Masala + Roti", cat: "Dinner", emoji: "🧈", cal: 700, p: 30, c: 60, f: 38 },
    { name: "Egg Curry + 2 Roti", cat: "Dinner", emoji: "🍳", cal: 560, p: 28, c: 54, f: 26 },
    { name: "Veg Pulao + Raita", cat: "Dinner", emoji: "🍚", cal: 480, p: 14, c: 74, f: 14 },
    { name: "Soya Masala + 2 Roti", cat: "Dinner", emoji: "🥘", cal: 500, p: 34, c: 58, f: 14 },
    { name: "Grilled Salmon + Asparagus", cat: "Dinner", emoji: "🐠", cal: 520, p: 46, c: 12, f: 32 },
    { name: "Mixed Dal + Rice", cat: "Dinner", emoji: "🍲", cal: 450, p: 18, c: 70, f: 9 },
  ];

  const DEFAULT_SPLIT = {
    d1: { title: "Day 1 — Push", note: "Chest, shoulders, triceps. Add 20-30 min incline walk after lifting.", exercises: [
      { name: "Barbell Bench Press", target: "4 × 6-8", rest: "120s", yt: "barbell+bench+press+form" },
      { name: "Incline Dumbbell Press", target: "3 × 8-10", rest: "90s", yt: "incline+dumbbell+press" },
      { name: "Seated Shoulder Press", target: "3 × 8-10", rest: "90s", yt: "seated+shoulder+press" },
      { name: "Cable Fly", target: "3 × 12-15", rest: "60s", yt: "cable+fly" },
      { name: "Lateral Raise", target: "3 × 12-15", rest: "60s", yt: "lateral+raise+form" },
      { name: "Triceps Rope Pushdown", target: "3 × 10-12", rest: "60s", yt: "triceps+rope+pushdown" },
    ]},
    d2: { title: "Day 2 — Pull", note: "Back, rear delts, biceps. Chest-supported rows protect the lower back.", exercises: [
      { name: "Chest-Supported T-Bar Row", target: "4 × 6-8", rest: "120s", yt: "chest+supported+t-bar+row" },
      { name: "Lat Pulldown (wide)", target: "4 × 8-10", rest: "90s", yt: "lat+pulldown+wide+grip" },
      { name: "Single-Arm DB Row", target: "3 × 8-10", rest: "90s", yt: "single+arm+dumbbell+row" },
      { name: "Seated Cable Row", target: "3 × 10-12", rest: "75s", yt: "seated+cable+row" },
      { name: "Face Pull", target: "3 × 15", rest: "60s", yt: "face+pull" },
      { name: "EZ-Bar Curl", target: "3 × 10-12", rest: "60s", yt: "ez+bar+curl" },
    ]},
    d3: { title: "Day 3 — Legs", note: "Quads, hamstrings, glutes, calves. Skip cardio today to protect performance.", exercises: [
      { name: "Barbell Back Squat", target: "4 × 6-8", rest: "150s", yt: "barbell+back+squat+form" },
      { name: "Leg Press", target: "3 × 10-12", rest: "120s", yt: "leg+press" },
      { name: "Walking Lunge (DB)", target: "3 × 10/leg", rest: "90s", yt: "dumbbell+walking+lunge" },
      { name: "Seated Leg Curl", target: "3 × 12-15", rest: "60s", yt: "seated+leg+curl" },
      { name: "Barbell Hip Thrust", target: "3 × 10-12", rest: "90s", yt: "barbell+hip+thrust" },
      { name: "Standing Calf Raise", target: "4 × 12-15", rest: "45s", yt: "standing+calf+raise" },
    ]},
    d4: { title: "Day 4 — Upper", note: "Chest, back, arms hypertrophy. 20-30 min incline walk after.", exercises: [
      { name: "Incline Barbell Press", target: "3 × 8-10", rest: "90s", yt: "incline+barbell+press" },
      { name: "Chest-Supported Row", target: "3 × 10-12", rest: "90s", yt: "chest+supported+row" },
      { name: "Machine Shoulder Press", target: "3 × 10-12", rest: "75s", yt: "machine+shoulder+press" },
      { name: "Close-Grip Lat Pulldown", target: "3 × 10-12", rest: "75s", yt: "close+grip+lat+pulldown" },
      { name: "Cable Lateral Raise", target: "3 × 15", rest: "45s", yt: "cable+lateral+raise" },
      { name: "Overhead Rope Extension", target: "3 × 10-12", rest: "60s", yt: "overhead+rope+triceps+extension" },
    ]},
    d5: { title: "Day 5 — Arms & Core", note: "Biceps, triceps, shoulders, abs. 20-30 min incline walk after.", exercises: [
      { name: "Barbell Curl", target: "3 × 8-10", rest: "75s", yt: "barbell+curl" },
      { name: "Skull Crushers", target: "3 × 8-10", rest: "75s", yt: "skull+crushers+ez+bar" },
      { name: "Seated DB Lateral Raise", target: "3 × 12-15", rest: "60s", yt: "seated+dumbbell+lateral+raise" },
      { name: "Rear Delt Fly", target: "3 × 15", rest: "60s", yt: "rear+delt+fly+machine" },
      { name: "Weighted Cable Crunch", target: "3 × 12-15", rest: "45s", yt: "cable+crunch" },
      { name: "Weighted Plank", target: "3 × 45s", rest: "45s", yt: "weighted+plank" },
    ]},
  };

  const DAY_ORDER = ["d1", "d2", "d3", "d4", "d5"];
  window.Data = { FOODS, DEFAULT_SPLIT, DAY_ORDER };
})();
