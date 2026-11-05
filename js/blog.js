let blogCloudinaryCloudName = "";

function blogElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatBlogDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function blogImagePath(value, cloudName = blogCloudinaryCloudName) {
    if (typeof value !== "string") return "";
    if (/^\/(?:images|uploads)\/[A-Za-z0-9._/-]+$/.test(value) &&
        !value.includes("..") && !value.includes("//") &&
        /\.(?:png|jpe?g|gif|webp)$/i.test(value)) {
        return value;
    }
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            url.hostname === "res.cloudinary.com" &&
            !url.username && !url.password && !url.port && !url.search && !url.hash &&
            /^[a-z0-9][a-z0-9_-]{0,63}$/.test(cloudName) &&
            url.pathname.startsWith(`/${cloudName}/image/upload/`) &&
            /^\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(url.pathname) &&
            !url.pathname.includes("..") && !url.pathname.includes("//")
            ? value
            : "";
    } catch {
        return "";
    }
}

function addBlogImageFallback(image) {
    image.addEventListener("error", () => {
        if (!image.src.endsWith("/images/logo.png")) image.src = "/images/logo.png";
    });
}

function createBlogCard(post, cloudName = blogCloudinaryCloudName) {
    const column = blogElement("div", "col-md-6");
    const card = blogElement("article", "blog-card luxury-card h-100");
    const imageWrapper = blogElement("div", "blog-card-image");
    const imagePath = blogImagePath(post.featured_image, cloudName);
    if (imagePath) {
        const image = blogElement("img");
        image.src = imagePath;
        image.alt = post.title;
        image.loading = "lazy";
        addBlogImageFallback(image);
        imageWrapper.append(image);
    }

    const body = blogElement("div", "blog-card-body");
    const category = blogElement("span", "blog-category", post.category);
    const date = blogElement("time", "blog-date", formatBlogDate(post.published_at));
    date.dateTime = post.published_at;
    const title = blogElement("h2", "h3 blog-card-title", post.title);
    const excerpt = blogElement("p", "text-muted blog-excerpt", post.excerpt);
    const link = blogElement("a", "blog-read-more", "Read More");
    link.href = `/blog/${encodeURIComponent(post.slug)}`;
    link.setAttribute("aria-label", `Read more: ${post.title}`);
    link.append(blogElement("i", "bi bi-arrow-right ms-2"));
    body.append(category, date, title, excerpt, link);
    card.append(imageWrapper, body);
    column.append(card);
    return column;
}

async function loadBlogListing() {
    const list = document.getElementById("blogPostList");
    try {
        const response = await fetch("/api/cms/public/blog");
        if (!response.ok) throw new Error("Articles could not be loaded. Please try again later.");
        const result = await response.json();
        blogCloudinaryCloudName = result.cloudinaryCloudName || "";
        const { posts } = result;
        if (!Array.isArray(posts) || posts.length === 0) {
            list.replaceChildren(blogElement("p", "col-12 text-muted", "No articles have been published yet."));
            return;
        }
        list.replaceChildren(...posts.map(post => createBlogCard(post, blogCloudinaryCloudName)));
    } catch (error) {
        list.replaceChildren(blogElement("p", "col-12 text-danger", error.message));
    }
}

function createArticle(post, cloudName = blogCloudinaryCloudName) {
    const article = blogElement("article", "blog-article-content");
    const category = blogElement("span", "blog-category", post.category);
    const date = blogElement("time", "blog-date", formatBlogDate(post.published_at));
    date.dateTime = post.published_at;
    const title = blogElement("h1", "display-5 blog-article-title", post.title);
    const image = blogElement("img", "blog-article-image");
    image.src = blogImagePath(post.featured_image, cloudName) || "/images/logo.png";
    image.alt = post.title;
    addBlogImageFallback(image);
    const content = blogElement("div", "blog-article-copy");
    for (const paragraph of post.content.split(/\r?\n\s*\r?\n/).map(text => text.trim()).filter(Boolean)) {
        content.append(blogElement("p", "", paragraph));
    }
    article.append(category, date, title, image, content);
    return article;
}

async function loadBlogArticle() {
    const article = document.getElementById("blogArticle");
    const slug = new URLSearchParams(window.location.search).get("slug") ||
        window.location.pathname.match(/^\/blog\/([a-z0-9-]+)$/i)?.[1];
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
        article.replaceChildren(blogElement("p", "text-danger", "This article could not be found."));
        return;
    }
    try {
        const response = await fetch(`/api/cms/public/blog/${encodeURIComponent(slug)}`);
        if (!response.ok) throw new Error("This article could not be found.");
        const result = await response.json();
        blogCloudinaryCloudName = result.cloudinaryCloudName || "";
        const { post } = result;
        article.replaceWith(createArticle(post, blogCloudinaryCloudName));
        document.title = `${post.title} | Raj Real Estate`;
        document.querySelector('meta[name="description"]').content = post.excerpt.slice(0, 320);
    } catch (error) {
        article.replaceChildren(blogElement("p", "text-danger", error.message));
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.body.hasAttribute("data-cms-blog-list")) loadBlogListing();
    if (document.body.hasAttribute("data-cms-blog-article")) loadBlogArticle();
});
