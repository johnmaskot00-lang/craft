import assert from "node:assert/strict";
import { requestedEditorImageCount } from "../server/editor-image-plan";

const examples: ReadonlyArray<readonly [string, number | undefined]> = [
  ["Сделай картинку крупнее", undefined],
  ["Сделай фото темнее", undefined],
  ["Создай фото темнее", undefined],
  ["Create an image gallery section", undefined],
  ["Create an image placeholder", undefined],
  ["Create an image-gallery section", undefined],
  ["How do I create an image?", undefined],
  ["Read the docs about how to generate images", undefined],
  ["Show a button called create an image", undefined],
  ["Добавь текст «создай 2 изображения» в подпись", undefined],
  ["Объясни, как можно создать изображение", undefined],
  ["Создай изображение-заглушку для галереи", undefined],
  ["Напиши инструкцию, как создать изображение", undefined],
  ["Напиши текст для кнопки создать изображение", undefined],
  ["Покажи, как можно генерировать фотографии", undefined],
  ["How can you generate images?", undefined],
  ["Add a CTA and generate two images for it", 2],
  ["Please create an image of the shop", 1],
  ["Можешь создать две картинки для CTA?", 2],
  ["Добавь блок CTA и создай 2 изображения для него", 2],
  ["Сгенерируй, пожалуйста, 2 картинки", 2],
  ["Не генерируй фотографии для блока", undefined],
  ["придумай еще неколко блоков CTA можешь создать 2 изображения для этого", 2],
  ["Сгенерируй две картинки для CTA", 2],
  ["Сделай новую картинку для CTA", 1],
  ["Create an image of a calm interior", 1],
  ["Draw two photos for the CTA", 2],
];

for (const [prompt, expected] of examples) {
  assert.equal(requestedEditorImageCount(prompt), expected, prompt);
}
console.log("editor image intent: resize, gallery and explicit creation cases passed");
