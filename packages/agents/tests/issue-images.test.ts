import { describe, expect, it } from "vitest";
import { issueImages, withImages } from "../src/maintainer/issue-images.js";

describe("issueImages", () => {
  it("finds GitHub-hosted screenshots in markdown and HTML, in order, without duplicates", () => {
    const body = [
      "Traceback below:",
      "![screenshot](https://github.com/user-attachments/assets/1b2c3d4e-0000-4a1b-9c2d-123456789abc)",
      '<img width="600" alt="error" src="https://user-images.githubusercontent.com/123/456-abc.png">',
      "![again](https://github.com/user-attachments/assets/1b2c3d4e-0000-4a1b-9c2d-123456789abc)",
    ].join("\n");

    expect(issueImages(body)).toEqual([
      "https://github.com/user-attachments/assets/1b2c3d4e-0000-4a1b-9c2d-123456789abc",
      "https://user-images.githubusercontent.com/123/456-abc.png",
    ]);
  });

  it("ignores images hosted anywhere else, non-https links and data URLs (issue text comes from strangers)", () => {
    const body = [
      "![a](http://user-images.githubusercontent.com/1/x.png)",
      "![b](https://evil.example/track.png)",
      "![c](https://169.254.169.254/latest/meta-data)",
      "![d](data:image/png;base64,AAAA)",
      "![e](https://github.com.evil.example/user-attachments/assets/x)",
    ].join("\n");

    expect(issueImages(body)).toEqual([]);
  });

  it("keeps at most four", () => {
    const body = Array.from({ length: 6 }, (_, i) => `![s](https://github.com/user-attachments/assets/${i}aaaaaaa)`).join("\n");

    expect(issueImages(body)).toHaveLength(4);
  });
});

describe("withImages", () => {
  it("adds the images to the last user message as image parts", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "the issue" },
    ];

    const out = withImages(messages, ["https://github.com/user-attachments/assets/abc"]);

    expect(out[0]).toEqual(messages[0]);
    expect(out[1].content).toEqual([
      { type: "text", text: "the issue" },
      { type: "image_url", image_url: { url: "https://github.com/user-attachments/assets/abc" } },
    ]);
  });

  it("leaves messages unchanged when there are no images", () => {
    const messages = [{ role: "user" as const, content: "x" }];

    expect(withImages(messages, [])).toBe(messages);
  });
});
