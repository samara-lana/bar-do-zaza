-- O Storage só apaga o que o usuário consegue "ver" pela API: sem esta regra,
-- tirar uma foto da galeria respondia ok mas deixava o arquivo lá.
-- (O público continua vendo as fotos pelo link público do bucket.)
create policy fotos_admin_le on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.eh_admin());
