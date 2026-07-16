import fixture from "./data.json" with { type: "json" };
document.documentElement.dataset.fixture = fixture.state;
