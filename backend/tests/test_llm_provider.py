from app.llm_provider import get_listing_llm_config, get_listing_llm_provider


def test_default_deepseek_reads_local_key_file(monkeypatch, tmp_path) -> None:
    key_file = tmp_path / "deepseek.txt"
    key_file.write_text("local-deepseek-key\n", encoding="utf-8")
    for name in ("LLM_PROVIDER", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY_FILE", str(key_file))

    key, base_url, model = get_listing_llm_config()

    assert get_listing_llm_provider() == "deepseek"
    assert key == "local-deepseek-key"
    assert base_url == "https://api.deepseek.com"
    assert model == "deepseek-v4-flash"


def test_volcano_can_use_legacy_environment_values(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "volcengine")
    monkeypatch.setenv("LLM_API_KEY", "legacy-volcano-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://ark.example.test/api/v3")
    monkeypatch.setenv("LLM_MODEL", "volcano-model")

    assert get_listing_llm_config() == (
        "legacy-volcano-key",
        "https://ark.example.test/api/v3",
        "volcano-model",
    )
