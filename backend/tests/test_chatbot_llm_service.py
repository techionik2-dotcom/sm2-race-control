import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.chatbot import ChatbotCard, ChatbotField, ChatbotQuery, ChatbotRecordReference, ChatbotResponse, ChatbotSection
from app.services import chatbot_llm_service
from app.services.chatbot_service import _greeting_response, _intent_from_query, _resolve_chatbot_intent


def _response(**overrides):
    payload = {
        "kind": "sessions",
        "title": "Latest Sessions",
        "summary": "I found 2 recent sessions in the SM2 Racing database.",
        "answer": "I found 2 recent sessions in the SM2 Racing database.",
        "data_found": True,
        "status": "success",
        "intent": "latest_sessions",
        "records_used": [
            ChatbotRecordReference(kind="session", value="S1", label="Session 1"),
            ChatbotRecordReference(kind="session", value="S2", label="Session 2"),
        ],
        "sections": [
            ChatbotSection(
                title="Latest sessions",
                subtitle="Newest records first.",
                variant="cards",
                cards=[
                    ChatbotCard(
                        title="Session 1",
                        subtitle="Apr 30, 3:30 PM",
                        badge="Ready",
                        fields=[
                            ChatbotField(label="Driver", value="Nicolas Guigere"),
                            ChatbotField(label="Vehicle", value="GT4"),
                            ChatbotField(label="Session ID", value="20260430-NG-S01"),
                        ],
                    )
                ],
            )
        ],
        "follow_up": ["Show setup for latest session", "Compare session 1 vs session 2"],
        "generated_at": datetime.now(timezone.utc),
    }
    payload.update(overrides)
    return ChatbotResponse(**payload)


class ChatbotLLMServiceTests(unittest.TestCase):
    def test_build_openai_context_uses_safe_structured_backend_data(self) -> None:
        backend_response = _response()
        scope = {
            "event_id": "event-001",
            "session_id": "20260430-NG-S01",
            "driver_id": "NG",
            "vehicle_id": "NG-GT4-2025",
            "ignored": "secret-value",
        }

        context = chatbot_llm_service.build_openai_context_from_backend_result(
            backend_response=backend_response,
            request_scope=scope,
        )

        self.assertEqual(context["kind"], "sessions")
        self.assertEqual(context["status"], "success")
        self.assertEqual(context["record_count"], 2)
        self.assertEqual(context["scope"]["event_id"], "event-001")
        self.assertNotIn("ignored", context["scope"])
        self.assertEqual(context["sections"][0]["title"], "Latest sessions")
        self.assertEqual(context["sections"][0]["cards"][0]["title"], "Session 1")
        self.assertEqual(context["sections"][0]["cards"][0]["fields"][0]["label"], "Driver")
        self.assertNotIn("generated_at", context)

    def test_finalize_chatbot_response_falls_back_cleanly_when_openai_is_disabled(self) -> None:
        backend_response = _response(
            kind="message",
            title="AI Race Assistant",
            summary="I can help with recent sessions and setup data.",
            answer="I can help with recent sessions and setup data.",
            data_found=False,
            intent="greeting",
            records_used=[],
            sections=[],
            follow_up=["Show latest sessions", "Show latest submissions"],
        )

        settings = SimpleNamespace(
            chatbot_nlp_enabled=False,
            openai_api_key=None,
            openai_model="gpt-4o-mini",
            openai_request_timeout_seconds=8.0,
            openai_intent_confidence_threshold=0.7,
        )

        with patch("app.services.chatbot_llm_service.get_settings", return_value=settings):
            finalized = chatbot_llm_service.finalize_chatbot_response(
                user_query="hi",
                backend_response=backend_response,
                request_scope=ChatbotQuery(message="hi"),
            )

        self.assertFalse(finalized.summary_result.used_openai)
        self.assertTrue(finalized.summary_result.fallback_used)
        self.assertEqual(finalized.response.summary, "I can help with recent sessions and setup data.")
        self.assertEqual(finalized.response.follow_up[:2], ["Show latest sessions", "Show latest submissions"])

    def test_finalize_chatbot_response_uses_openai_summary_when_available(self) -> None:
        backend_response = _response(
            kind="compare",
            title="Session Comparison",
            summary="Here is a comparison of Session 1 and Session 2.",
            answer="Here is a comparison of Session 1 and Session 2.",
            intent="compare",
        )

        settings = SimpleNamespace(
            chatbot_nlp_enabled=True,
            openai_api_key="test-key",
            openai_model="gpt-4o-mini",
            openai_request_timeout_seconds=8.0,
            openai_intent_confidence_threshold=0.7,
        )
        openai_result = {
            "summary": "Here is a comparison of Session 1 and Session 2, with the biggest setup changes highlighted first.",
            "follow_up": ["Show tire pressures only", "Show full setup for latest session"],
            "response_type": "comparison_summary",
        }

        with (
            patch("app.services.chatbot_llm_service.get_settings", return_value=settings),
            patch("app.services.chatbot_llm_service._call_openai_json", return_value=(openai_result, None)),
        ):
            finalized = chatbot_llm_service.finalize_chatbot_response(
                user_query="compare session 1 vs session 2",
                backend_response=backend_response,
                request_scope=ChatbotQuery(message="compare session 1 vs session 2"),
            )

        self.assertTrue(finalized.summary_result.used_openai)
        self.assertFalse(finalized.summary_result.fallback_used)
        self.assertEqual(
            finalized.response.summary,
            "Here is a comparison of Session 1 and Session 2, with the biggest setup changes highlighted first.",
        )
        self.assertEqual(
            finalized.response.follow_up,
            ["Show tire pressures only", "Show full setup for latest session"],
        )

    def test_intent_from_query_recognizes_greeting_and_compare_variants(self) -> None:
        self.assertEqual(_intent_from_query("hello"), "greeting")
        self.assertEqual(_intent_from_query("who are you"), "help_services")
        self.assertEqual(_intent_from_query("what services do you provide"), "help_services")
        self.assertEqual(_intent_from_query("what services you can provide"), "help_services")
        self.assertEqual(_intent_from_query("what services can you provide"), "help_services")
        self.assertEqual(_intent_from_query("show options"), "help_services")
        self.assertEqual(_intent_from_query("services"), "help_services")
        self.assertEqual(_intent_from_query("good morning"), "greeting")
        self.assertEqual(_intent_from_query("thanks"), "thanks")
        self.assertEqual(_intent_from_query("what changed from the last session?"), "compare")
        self.assertEqual(_intent_from_query("compare previous session with current"), "compare")
        self.assertEqual(_intent_from_query("which one is better"), "recommendation")
        self.assertEqual(_intent_from_query("how can I improve?"), "coaching")
        self.assertEqual(_intent_from_query("show latest events"), "list_events")
        self.assertEqual(_intent_from_query("show latest drivers"), "driver_vehicle_data")
        self.assertEqual(_intent_from_query("show vehicle info"), "driver_vehicle_data")
        self.assertEqual(_intent_from_query("show user data"), "driver_vehicle_data")
        self.assertEqual(_intent_from_query("list users"), "driver_vehicle_data")

    def test_greeting_response_uses_short_welcome_for_simple_hi(self) -> None:
        response = _greeting_response("hi")

        self.assertEqual(response.status, "success")
        self.assertEqual(response.intent, "greeting")
        self.assertEqual(
            response.summary,
            "Hello, and welcome to the SM Racing System. I can help you with SM Racing race data and setup tasks. How Can I help you?",
        )
        self.assertEqual(response.data["greeting_style"], "greeting")
        self.assertEqual(response.follow_up[:2], ["Show latest events", "Show latest sessions"])

    def test_greeting_response_uses_capability_variant_for_identity_question(self) -> None:
        response = _greeting_response("what are you")

        self.assertEqual(response.status, "success")
        self.assertEqual(response.intent, "help_services")
        self.assertTrue(response.summary.startswith("I can help you with SM Racing race data and setup tasks."))
        self.assertIn("Compare sessions and highlight changes", response.summary)
        self.assertEqual(response.data["greeting_style"], "help_services")
        self.assertEqual(response.follow_up[:2], ["Show latest events", "Show latest sessions"])

    def test_greeting_response_uses_thanks_variant(self) -> None:
        response = _greeting_response("thanks")

        self.assertEqual(response.status, "success")
        self.assertEqual(response.intent, "thanks")
        self.assertTrue(response.summary.startswith("You're welcome."))
        self.assertEqual(response.data["greeting_style"], "thanks")

    def test_greeting_response_uses_time_based_variant(self) -> None:
        response = _greeting_response("good evening")

        self.assertEqual(response.status, "success")
        self.assertEqual(response.intent, "greeting")
        self.assertEqual(
            response.summary,
            "Hello, and welcome to the SM Racing System. I can help you with SM Racing race data and setup tasks. How Can I help you?",
        )
        self.assertEqual(response.data["greeting_style"], "greeting")

    def test_fallback_plain_response_uses_full_greeting_when_backend_summary_missing(self) -> None:
        backend_response = _response(
            kind="message",
            title="AI Race Assistant",
            summary="",
            answer="",
            data_found=True,
            intent="greeting",
            records_used=[],
            sections=[],
            follow_up=[],
        )

        fallback = chatbot_llm_service.fallback_plain_response(
            user_query="what are you",
            backend_response=backend_response,
        )

        self.assertEqual(
            fallback.summary,
            "Hello, and welcome to the SM Racing System. I can help you with SM Racing race data and setup tasks. How Can I help you?",
        )
        self.assertEqual(fallback.response_type, "greeting")

    def test_fallback_plain_response_uses_capability_text_for_help_services_when_backend_summary_missing(self) -> None:
        backend_response = _response(
            kind="message",
            title="AI Race Assistant",
            summary="",
            answer="",
            data_found=True,
            intent="help_services",
            records_used=[],
            sections=[],
            follow_up=[],
        )

        fallback = chatbot_llm_service.fallback_plain_response(
            user_query="what can you do",
            backend_response=backend_response,
        )

        self.assertEqual(
            fallback.summary,
            "I can help you with SM Racing race data and setup tasks.\nHere are the main things I can do:\n- Show latest events, sessions, drivers, vehicles, and submissions\n- Display setup details for a selected or latest session\n- Compare sessions and highlight changes\n- Review tire pressures, temperatures, suspension, and alignment\n- Summarize race notes and submissions\n- Suggest setup improvements based on previous session data",
        )

    def test_generate_nlp_response_skips_openai_for_known_deterministic_queries(self) -> None:
        backend_response = _response(
            kind="sessions",
            summary="I found 2 recent sessions in the SM2 Racing database.",
            answer="I found 2 recent sessions in the SM2 Racing database.",
            intent="latest_sessions",
            follow_up=["Show setup for latest session", "Compare session 1 vs session 2"],
        )
        settings = SimpleNamespace(
            chatbot_nlp_enabled=True,
            openai_api_key="test-key",
            openai_model="gpt-4o-mini",
            openai_request_timeout_seconds=8.0,
            openai_intent_confidence_threshold=0.7,
        )

        with (
            patch("app.services.chatbot_llm_service.get_settings", return_value=settings),
            patch("app.services.chatbot_llm_service._call_openai_json") as openai_call,
        ):
            summary_result = chatbot_llm_service.generate_nlp_response(
                user_query="show latest sessions",
                backend_response=backend_response,
                request_scope=ChatbotQuery(message="show latest sessions"),
            )

        openai_call.assert_not_called()
        self.assertFalse(summary_result.used_openai)
        self.assertTrue(summary_result.fallback_used)
        self.assertEqual(summary_result.summary, "I found 2 recent sessions in the SM2 Racing database.")

    def test_resolve_chatbot_intent_uses_openai_first_for_sloppy_known_queries(self) -> None:
        settings = SimpleNamespace(
            openai_intent_confidence_threshold=0.7,
        )
        nlp_result = SimpleNamespace(
            intent="latest_sessions",
            confidence=0.93,
            filters={},
            explanation="Mapped 'latest results' to the latest sessions intent.",
        )

        with (
            patch("app.services.chatbot_service.get_settings", return_value=settings),
            patch("app.services.chatbot_service._nlp_intent_from_query", return_value=nlp_result),
        ):
            intent, deterministic_intent, resolved_nlp_result, nlp_filters = _resolve_chatbot_intent(
                "Okay. So show me the all the latest results",
                ChatbotQuery(message="Okay. So show me the all the latest results"),
            )

        self.assertEqual(deterministic_intent, "unsupported")
        self.assertEqual(intent, "latest_sessions")
        self.assertIsNotNone(resolved_nlp_result)
        self.assertEqual(nlp_filters, {})

    def test_fallback_plain_response_preserves_narrative_paragraph_breaks(self) -> None:
        backend_response = _response(
            kind="compare",
            title="Session Comparison",
            summary="Executive summary line.\n\nSecond paragraph with the main setup change.",
            answer="Executive summary line.\n\nSecond paragraph with the main setup change.",
            intent="compare",
        )

        fallback = chatbot_llm_service.fallback_plain_response(
            user_query="compare session 1 vs session 2",
            backend_response=backend_response,
        )

        self.assertIn("\n\n", fallback.summary)
        self.assertTrue(fallback.summary.startswith("Executive summary line."))
        self.assertIn("Second paragraph with the main setup change.", fallback.summary)

    def test_fallback_response_types_cover_recommendation_and_coaching(self) -> None:
        recommendation_response = _response(kind="recommendation", intent="recommendation")
        coaching_response = _response(kind="coaching", intent="coaching")

        recommendation_fallback = chatbot_llm_service.fallback_plain_response(
            user_query="which one is better",
            backend_response=recommendation_response,
        )
        coaching_fallback = chatbot_llm_service.fallback_plain_response(
            user_query="how can I improve",
            backend_response=coaching_response,
        )

        self.assertEqual(recommendation_fallback.response_type, "recommendation_summary")
        self.assertEqual(coaching_fallback.response_type, "coaching_summary")


if __name__ == "__main__":
    unittest.main()
