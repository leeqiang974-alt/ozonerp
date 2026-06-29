import test from "node:test";
import assert from "node:assert/strict";
import { deriveNewSourceKeywords } from "../src/autoListing.js";

test("deriveNewSourceKeywords keeps search keywords in priority order", () => {
  const keywords = deriveNewSourceKeywords({
    keyword: "кошачий фонтан",
    searchKeywords: ["фонтан для кошек", "кошачий фонтан", "поилка для котов"],
    bestMatch: { candidateTitle: "宠物饮水机" },
    ozonTitle: "Автокормушка для кошек",
  });

  assert.deepEqual(keywords.slice(0, 3), ["фонтан для кошек", "кошачий фонтан", "поилка для котов"]);
});
