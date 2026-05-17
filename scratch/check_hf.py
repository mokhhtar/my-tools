from huggingface_hub import InferenceClient
import requests

# Test with a lightweight model to verify connectivity
client = InferenceClient(model="gpt2", token="")
try:
    print(f"Trying to call GPT2 via InferenceClient...")
    # InferenceClient has a high-level task for text generation
    res = client.text_generation("Hello")
    print(f"Success! Response: {res}")
except Exception as e:
    print(f"Failed: {e}")
