# Image Rendering Test

This document tests all image src types to identify which ones render vs. fail.

## 1. Relative Image (same directory)

Should show a red 1×1 pixel image:

![Red pixel test](test-red.png)

## 2. Relative Image (sub-path style)

![Blue pixel test](./test-blue.png)

## 3. HTTPS URL Image

![GitHub Octocat](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

## 4. HTTP URL Image

![W3C logo](http://www.w3.org/Icons/w3c_home)

## 5. Data URI (inline base64 PNG — 1×1 green pixel)

![Inline green pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

## 6. Inline image inside a paragraph

This is a paragraph with an inline image: ![alt text](test-red.png) embedded in text.

## 7. Image with title (double-quote)

![Red with title](test-red.png "This is a title")

## 7b. Image with title (single-quote)

![Blue with title](./test-blue.png 'Single quote title')

## 7c. Image with title containing special chars

![Red special title](test-red.png "Title with <angle> & 'quotes'")

## 7d. Inline image with title

This paragraph has an inline image: ![inline titled](test-red.png "Inline title text") right here.

## 8. Missing image (should show graceful broken state)

![This image does not exist](missing-image.png)

## Summary

If relative paths work, cases 1, 2, 6, 7, 7b, 7c, 7d should show images.
Cases 3 and 4 depend on network access.
Case 5 (data URI) should always work.
Case 8 should show a graceful broken-image placeholder.
